import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

// Presentation-only checks: no account, booking or financial fixtures are created.
const storySelector = ".home-dashboard-story";
type HomeCLSWindow = Window & {
  __avielleHomeCLS: { supported: boolean; value: number };
};

async function progress(story: Locator) {
  return Number.parseFloat(
    (await story.getAttribute("data-motion-progress")) || "NaN",
  );
}

async function scrollStory(story: Locator, fraction: number) {
  await story.evaluate((section, amount) => {
    const start = window.scrollY + section.getBoundingClientRect().top;
    const stage = section.querySelector<HTMLElement>(".home-dashboard-stage")!;
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
  await mkdir(path.resolve(".local/qa"), { recursive: true });
  await page.screenshot({ path: path.resolve(".local/qa", filename) });
}

async function transform(scene: Locator) {
  return scene.evaluate((element) => getComputedStyle(element).transform);
}

test("home dashboard preview has real depth, follows scroll and supports accessible pause controls", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.addInitScript(() => {
    const metrics = {
      supported:
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
      value: 0,
    };
    (window as unknown as HomeCLSWindow).__avielleHomeCLS = metrics;
    if (!metrics.supported) return;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        };
        if (!shift.hadRecentInput) metrics.value += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const story = page.locator(storySelector);
  const stage = story.locator(".home-dashboard-stage");
  const preview = story.locator(".home-dashboard-preview");
  const scene = story.locator(".home-dashboard-scene");
  await expect(story).toBeVisible();
  await expect(stage).toHaveCSS("position", "sticky");
  await expect.poll(() => progress(story)).toBe(0);
  await expect(story).toHaveAttribute("data-motion-ready", "true");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAccessibleName("Dashboard design preview");
  await expect(preview).toContainText("Your wardrobe, in motion.", {
    useInnerText: true,
  });
  await expect(story.locator(".home-dashboard-caption")).toContainText(
    "Illustrative layout · your activity appears after sign-in",
  );
  await expect(story.locator(".home-preview-shell")).toBeVisible();
  expect(await story.locator(".home-preview-layer").count()).toBeGreaterThan(0);
  await expect(page.locator("canvas, video")).toHaveCount(0);
  const initialTransform = await transform(scene);
  expect(initialTransform).toMatch(/^matrix3d\(/);
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
  // Sample the settled first paint before any scroll or input could suppress
  // layout-shift reporting. The observer started before document creation.
  await page.waitForTimeout(500);
  await capture(page, "home-animation-initial-desktop.png");
  const initialCLS = await page.evaluate(
    () => (window as unknown as HomeCLSWindow).__avielleHomeCLS,
  );
  expect(initialCLS.supported).toBe(true);
  expect(initialCLS.value).toBeLessThan(0.1);

  await scrollStory(story, 0.55);
  await expect.poll(() => progress(story)).toBeGreaterThan(0.4);
  await expect.poll(() => transform(scene)).not.toBe(initialTransform);
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
  await expect.poll(() => progress(story)).toBe(0.7);

  // Mouse movement must alter the actual rendered CSS 3D matrix, not merely
  // a progress attribute. Both checks exercise the real home component.
  const bounds = (await preview.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width * 0.15,
    bounds.y + bounds.height * 0.2,
  );
  const beforePointer = await transform(scene);
  await page.mouse.move(
    bounds.x + bounds.width * 0.85,
    bounds.y + bounds.height * 0.8,
  );
  await expect.poll(() => transform(scene)).not.toBe(beforePointer);

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
  const pausedTransform = await transform(scene);
  await scrollStory(story, 0.9);
  await page.mouse.move(bounds.x + 30, bounds.y + 30);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
      ),
  );
  expect(await progress(story)).toBe(pausedProgress);
  expect(await transform(scene)).toBe(pausedTransform);
  expect(
    await story.evaluate(
      (section) =>
        section
          .getAnimations({ subtree: true })
          .filter((animation) => animation.playState === "running").length,
    ),
  ).toBe(0);
  await story
    .getByRole("button", { name: "Resume home animation", exact: true })
    .click();
  await expect(pause).toBeVisible();
  await expect(story).toHaveAttribute("data-paused", "false");
  await expect.poll(() => progress(story)).toBeGreaterThan(0.8);

  await assertNoOverflow(page);
  await capture(page, "home-animation-desktop.png");
  expect(exceptions).toEqual([]);
});

test("home dashboard preview fits tablet and mobile while wardrobe links remain usable", async ({
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
    { width: 812, height: 375, pinned: false },
  ];
  for (const { width, height, pinned } of viewports) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const story = page.locator(storySelector);
    await expect(story).toBeVisible();
    await expect(story).toHaveAttribute("data-motion-ready", "true");
    await assertNoOverflow(page);
    await capture(page, `home-animation-initial-${width}.png`);
    const stage = story.locator(".home-dashboard-stage");
    const caption = story.locator(".home-dashboard-caption");
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
    await expect(story.locator(".home-dashboard-preview")).toBeVisible();
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

test("reduced motion keeps the home dashboard preview static through scrolling", async ({
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
  await expect(story.locator(".home-dashboard-scene")).toHaveCSS(
    "transform",
    "none",
  );
  for (const layer of await story.locator(".home-preview-layer").all()) {
    await expect(layer).toHaveCSS("transform", "none");
  }
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

test("server-rendered dashboard preview and navigation remain usable without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    const exceptions: string[] = [];
    page.on("pageerror", (error) => exceptions.push(error.message));
    await page.goto("/");
    const story = page.locator(storySelector);
    await expect(story).toBeVisible();
    await expect(story).toHaveAttribute("data-motion-ready", "false");
    await expect(story.locator(".home-dashboard-preview")).toBeVisible();
    await expect(story.locator(".home-preview-shell")).toContainText(
      "Your wardrobe, in motion.",
      { useInnerText: true },
    );
    await expect(story.locator(".home-dashboard-caption")).toContainText(
      "Illustrative layout · your activity appears after sign-in",
    );
    await expect(
      story.getByRole("button", { name: /home animation$/ }),
    ).toHaveCount(0);
    await expect(page.locator("canvas, video")).toHaveCount(0);
    await expect(story.locator('a[href="/list"]').first()).toHaveAttribute(
      "href",
      "/list",
    );
    await assertNoOverflow(page);
    await capture(page, "home-dashboard-preview-no-javascript.png");
    await story.locator('a[href="/explore"]').first().click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.locator(storySelector)).toHaveCount(0);
    expect(exceptions).toEqual([]);
  } finally {
    await context.close();
  }
});

test("the animated dashboard preview is restricted to the home route", async ({
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
    await expect(page.locator(".home-dashboard-scene")).toHaveCount(0);
    await expect(page.locator(".home-dashboard-preview")).toHaveCount(0);
    await assertNoOverflow(page);
  }
  expect(exceptions).toEqual([]);
});
