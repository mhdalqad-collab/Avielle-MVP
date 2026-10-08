import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Presentation-only checks: no account, booking or financial fixtures are created.
const storySelector = ".home-fashion-story";

async function progress(story: Locator) {
  return Number.parseFloat(
    (await story.getAttribute("data-motion-progress")) || "NaN",
  );
}

async function scrollStory(story: Locator, fraction: number) {
  await story.evaluate((section, amount) => {
    const start = window.scrollY + section.getBoundingClientRect().top;
    const stage = section.querySelector<HTMLElement>(".home-fashion-stage")!;
    const travel = Math.max(
      0,
      (section as HTMLElement).offsetHeight - stage.clientHeight,
    );
    window.scrollTo({ top: start + travel * amount, behavior: "instant" });
  }, fraction);
}

async function assertNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function capture(page: Page, filename: string) {
  const story = page.locator(storySelector);
  if ((await story.getAttribute("data-visual-state")) === "ready") {
    await expect(story.locator(".home-fashion-canvas")).toHaveCSS(
      "opacity",
      "1",
    );
    await expect(story.locator(".home-fashion-fallback")).toHaveCSS(
      "opacity",
      "0",
    );
  }
  await mkdir(path.resolve(".local/qa"), { recursive: true });
  await page.screenshot({ path: path.resolve(".local/qa", filename) });
}

test("home fashion scene renders, stays pinned and follows scroll with accessible pause controls", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const story = page.locator(storySelector);
  const stage = story.locator(".home-fashion-stage");
  const canvas = story.locator(".home-fashion-canvas");
  await expect(story).toBeVisible();
  await expect(stage).toHaveCSS("position", "sticky");
  await expect.poll(() => progress(story)).toBe(0);
  await expect(story).toHaveAttribute("data-visual-state", "ready");
  await expect(canvas).toBeVisible();
  const pageTitle = page.getByRole("heading", {
    level: 1,
    name: "Great style. A lighter footprint.",
    exact: true,
  });
  await expect(pageTitle).toHaveCount(1);
  const panels = story.locator(".home-story-panel");
  await expect(panels.nth(0)).toBeVisible();
  await expect(panels.nth(1)).toBeHidden();
  await expect(panels.nth(2)).toBeHidden();
  await expect(story.locator('a[href="/explore"]').first()).toBeVisible();
  await expect(story.locator('a[href="/list"]').first()).toHaveAttribute(
    "href",
    "/list",
  );
  await expect(page.locator("video[autoplay]")).toHaveCount(0);
  await capture(page, "home-animation-initial-desktop.png");

  await scrollStory(story, 0.55);
  await expect.poll(() => progress(story)).toBeGreaterThan(0.4);
  await expect(panels.nth(0)).toBeHidden();
  await expect(panels.nth(1)).toBeVisible();
  await expect(pageTitle).toHaveCount(1);
  await expect(pageTitle).toHaveAccessibleName(
    "Great style. A lighter footprint.",
  );
  const firstTop = (await stage.boundingBox())!.y;
  await scrollStory(story, 0.7);
  await expect.poll(() => progress(story)).toBeGreaterThan(0.6);
  await expect(panels.nth(1)).toBeHidden();
  await expect(panels.nth(2)).toBeVisible();
  await expect(pageTitle).toHaveCount(1);
  await expect(pageTitle).toHaveAccessibleName(
    "Great style. A lighter footprint.",
  );
  expect(
    Math.abs((await stage.boundingBox())!.y - firstTop),
  ).toBeLessThanOrEqual(2);

  const pause = story.getByRole("button", {
    name: "Pause home animation",
    exact: true,
  });
  await pause.click();
  await expect(
    story.getByRole("button", { name: "Resume home animation", exact: true }),
  ).toBeVisible();
  await expect(story).toHaveAttribute("data-paused", "true");
  await expect(pause).toHaveCount(0);
  const pausedProgress = await progress(story);
  await scrollStory(story, 0.9);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
  expect(await progress(story)).toBe(pausedProgress);
  await story
    .getByRole("button", { name: "Resume home animation", exact: true })
    .click();
  await expect(pause).toBeVisible();
  await expect(story).toHaveAttribute("data-paused", "false");
  await expect.poll(() => progress(story)).toBeGreaterThan(0.8);

  // Inspect the actual WebGL canvas capture rather than substituting a renderer.
  const pixels = await sharp(await canvas.screenshot()).stats();
  expect(pixels.channels.some((channel) => channel.stdev > 8)).toBe(true);
  await assertNoOverflow(page);
  await capture(page, "home-animation-desktop.png");
  expect(exceptions).toEqual([]);
});

test("home scene fits tablet and mobile while its existing wardrobe links remain usable", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  const viewports = [
    { width: 768, height: 844, pinned: true },
    { width: 390, height: 844, pinned: true },
    { width: 375, height: 667, pinned: true },
    { width: 1280, height: 640, pinned: true },
    { width: 320, height: 568, pinned: false },
  ];
  for (const { width, height, pinned } of viewports) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const story = page.locator(storySelector);
    await expect(story).toBeVisible();
    await expect(story).toHaveAttribute("data-visual-state", "ready");
    await assertNoOverflow(page);
    await capture(page, `home-animation-initial-${width}.png`);
    const stage = story.locator(".home-fashion-stage");
    const caption = story.locator(".home-fashion-caption");
    if (pinned) {
      await expect(stage).toHaveCSS("position", "sticky");
      if (width === 375) {
        await scrollStory(story, 0);
        await capture(page, "home-animation-pinned-first-375x667.png");
      }
      await scrollStory(story, 0.6);
      await expect.poll(() => progress(story)).toBeGreaterThan(0.4);
      const stageBounds = (await stage.boundingBox())!;
      expect(stageBounds.y + stageBounds.height).toBeLessThanOrEqual(
        height + 1,
      );
      const captionBounds = (await caption.boundingBox())!;
      expect(captionBounds.y).toBeGreaterThanOrEqual(0);
      expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(
        height + 1,
      );
    } else {
      await expect(stage).toHaveCSS("position", "relative");
      // A short screen uses ordinary page scrolling rather than clipping a
      // full-screen pinned scene. Every caption must remain reachable.
      expect(
        await stage.evaluate(
          (element) => element.scrollHeight <= element.clientHeight + 1,
        ),
      ).toBe(true);
      await caption.scrollIntoViewIfNeeded();
      const stageBounds = (await stage.boundingBox())!;
      const captionBounds = (await caption.boundingBox())!;
      expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(
        height + 1,
      );
      expect(captionBounds.y + captionBounds.height).toBeLessThanOrEqual(
        stageBounds.y + stageBounds.height + 1,
      );
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    }
    await expect(story.locator(".home-fashion-canvas")).toBeVisible();
    await assertNoOverflow(page);
    await capture(page, `home-animation-${width}.png`);
    const explore = story.locator('a[href="/explore"]').first();
    await expect(explore).toBeVisible();
    await explore.click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.locator(storySelector)).toHaveCount(0);
  }
  expect(exceptions).toEqual([]);
});

test("reduced motion keeps the home scene static through scrolling", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const story = page.locator(storySelector);
  await expect(story).toBeVisible();
  await expect(story).toHaveAttribute("data-reduced-motion", "true");
  await expect.poll(() => progress(story)).toBe(0);
  await expect(
    story.getByRole("button", { name: /home animation$/ }),
  ).toHaveCount(0);
  await scrollStory(story, 0.7);
  await expect.poll(() => progress(story)).toBe(0);
  expect(
    await story.evaluate(
      (section) =>
        section
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  await assertNoOverflow(page);
  await capture(page, "home-animation-reduced-motion.png");
  expect(exceptions).toEqual([]);
});

test("WebGL unavailable preserves the editorial image and shopping navigation", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...options: unknown[]
    ) {
      if (["webgl", "webgl2", "experimental-webgl"].includes(kind)) return null;
      return original.apply(this, [kind, ...options] as Parameters<
        typeof original
      >);
    } as typeof original;
  });
  await page.goto("/");
  const story = page.locator(storySelector);
  await expect(story).toBeVisible();
  await expect(story).toHaveAttribute("data-visual-state", "fallback");
  const fallback = story.locator('img[src="/images/hero.jpg"]');
  await expect(fallback).toBeVisible();
  await expect
    .poll(() =>
      fallback.evaluate(
        (image) =>
          (image as HTMLImageElement).complete &&
          (image as HTMLImageElement).naturalWidth > 0,
      ),
    )
    .toBe(true);
  await assertNoOverflow(page);
  await story.locator('a[href="/explore"]').first().click();
  await expect(page).toHaveURL(/\/explore$/);
  expect(exceptions).toEqual([]);
});

test("the animated fashion story is restricted to the home route", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  for (const route of ["/login", "/explore", "/dashboard"]) {
    await page.goto(route);
    if (route === "/dashboard") {
      await expect(
        page.getByRole("heading", {
          name: "Your wardrobe starts here",
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(page.locator(storySelector)).toHaveCount(0);
    await expect(page.locator(".home-fashion-canvas")).toHaveCount(0);
    await assertNoOverflow(page);
  }
  expect(exceptions).toEqual([]);
});
