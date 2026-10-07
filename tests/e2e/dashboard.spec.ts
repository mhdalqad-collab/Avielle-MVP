import { test, expect, type Page, type Locator } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// UI fixtures live only in the isolated local e2e database. No provider is mocked
// here: dashboard counts, history, profiles and photos come from persisted rows.
const prefix = `dashboard_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const password = "Dashboard-browser-test-2026!";
const emails = ["lender", "renter", "creator"].map(
  (role) => `${prefix}_${role}@example.invalid`,
);
type FixtureUser = { id: string; name: string; email: string };
let users: FixtureUser[] = [];
let listingIds: string[] = [];
let photoKeys: string[] = [];
let bookings: { id: string; status: string }[] = [];
let db: typeof import("../../lib/db").db;
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL || "http://invalid");
  expect(["127.0.0.1", "localhost"]).toContain(target.hostname);
  expect(target.pathname).toMatch(/_e2e$/);
  expect(process.env.NODE_ENV).not.toBe("production");
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  ({ db } = await import("../../lib/db"));
  const { hashPassword } = await import("../../lib/password");
  const passwordHash = await hashPassword(password);
  for (const [index, name] of [
    "Dana Lender",
    "Maya Renter",
    "Lina Creator",
  ].entries()) {
    users.push(
      await db.user.create({
        data: {
          email: emails[index],
          name,
          passwordHash,
          bio: "Thoughtfully collected occasion pieces.",
          location: "London",
          emailVerifiedAt: new Date(),
          payoutsEnabled: index === 0,
        },
      }),
    );
  }
  await mkdir(path.resolve(".local/uploads"), { recursive: true });
  const bytes = await sharp(path.resolve("public/images/hero.jpg"))
    .resize(600, 800, { fit: "cover" })
    .webp({ quality: 72 })
    .toBuffer();
  const alternate = await sharp(bytes)
    .modulate({ brightness: 0.9 })
    .webp({ quality: 72 })
    .toBuffer();
  const images: string[] = [];
  for (const image of [bytes, alternate]) {
    const key = `${randomUUID()}.webp`;
    photoKeys.push(key);
    await writeFile(path.resolve(".local/uploads", key), image);
    const upload = await db.upload.create({
      data: {
        ownerId: users[0].id,
        key,
        purpose: "LISTING",
        mimeType: "image/webp",
        bytes: image.length,
      },
    });
    images.push(`/api/media/${upload.id}`);
  }
  for (let index = 0; index < 7; index++) {
    const listing = await db.listing.create({
      data: {
        ownerId: users[0].id,
        title: `${prefix} silk piece ${index + 1}`,
        description:
          "An accurately described garment for an isolated dashboard browser test.",
        brand: "Avielle QA wardrobe",
        category: "Dresses",
        size: "M",
        condition: "Excellent",
        location: "London",
        dailyRate: 2500,
        cleaningFee: 500,
        deposit: 10000,
        images,
        availableFrom: day(-40),
        availableTo: day(70),
        status: index < 5 ? "ACTIVE" : index === 5 ? "PAUSED" : "PENDING",
        createdAt: new Date(Date.now() - index * 1000),
      },
    });
    listingIds.push(listing.id);
  }
  // A distinct genuine fixture closet makes the spotlight/member CTA testable.
  const creatorKey = `${randomUUID()}.webp`;
  photoKeys.push(creatorKey);
  await writeFile(path.resolve(".local/uploads", creatorKey), bytes);
  const creatorUpload = await db.upload.create({
    data: {
      ownerId: users[2].id,
      key: creatorKey,
      purpose: "LISTING",
      mimeType: "image/webp",
      bytes: bytes.length,
    },
  });
  const creatorListing = await db.listing.create({
    data: {
      ownerId: users[2].id,
      title: `${prefix} creator occasion dress`,
      description: "A real published fixture garment from another member.",
      brand: "Avielle QA creator",
      category: "Dresses",
      size: "S",
      condition: "Excellent",
      location: "London",
      dailyRate: 3000,
      deposit: 10000,
      images: [`/api/media/${creatorUpload.id}`],
      availableFrom: day(0),
      availableTo: day(70),
      status: "ACTIVE",
      createdAt: new Date(Date.now() + 1000),
    },
  });
  listingIds.push(creatorListing.id);
  const stages = [
    "REQUESTED",
    "CONFIRMED",
    "IN_USE",
    "RETURNED",
    "COMPLETED",
    "COMPLETED",
    "DECLINED",
  ];
  for (const [index, status] of stages.entries()) {
    const offset =
      status === "REQUESTED"
        ? 20
        : status === "CONFIRMED"
          ? 10
          : status === "IN_USE"
            ? 0
            : -10 - index * 4;
    const rental = index === 4 ? 12000 : index === 5 ? 18000 : 7500;
    const cleaningFee = index === 4 ? 160 : index === 5 ? 240 : 500;
    const serviceFee = Math.round(rental * 0.08);
    const booking = await db.booking.create({
      data: {
        listingId: listingIds[index < 5 ? index : 0],
        renterId: users[1].id,
        startDate: day(offset),
        endDate: day(offset + 2),
        days: 3,
        rental,
        cleaningFee,
        serviceFee,
        deposit: 10000,
        total: rental + cleaningFee + serviceFee + 10000,
        ownerEarnings: rental - Math.round(rental * 0.18) + cleaningFee,
        status,
        paymentStatus: ["REQUESTED", "DECLINED"].includes(status)
          ? "UNPAID"
          : status === "COMPLETED"
            ? "PARTIALLY_REFUNDED"
            : "PAID",
        payoutStatus: status === "COMPLETED" ? "TRANSFERRED" : "PENDING",
        refundedAmount: status === "COMPLETED" ? 10000 : 0,
        expiresAt:
          status === "REQUESTED" ? new Date(Date.now() + 86_400_000) : null,
        createdAt: new Date(Date.now() - index * 60_000),
      },
    });
    bookings.push({ id: booking.id, status });
    if (status === "COMPLETED")
      await db.review.create({
        data: {
          bookingId: booking.id,
          authorId: users[1].id,
          rating: index === 4 ? 4 : 5,
          comment: `Real fixture review ${index}.`,
        },
      });
    await db.bookingEvent.create({
      data: {
        bookingId: booking.id,
        actorId: status === "REQUESTED" ? users[1].id : users[0].id,
        type: status,
        detail: `Persisted ${status.toLowerCase()} fixture event.`,
      },
    });
  }
  await db.notification.create({
    data: {
      userId: users[0].id,
      title: "requested",
      body: "Your test wardrobe received a genuine persisted request.",
      bookingId: bookings[0].id,
    },
  });
  await db.notification.create({
    data: {
      userId: users[0].id,
      title: "completed",
      body: "A completed test rental has a recorded lender transfer.",
      bookingId: bookings[4].id,
      createdAt: new Date(Date.now() - 60_000),
    },
  });
});

test.afterAll(async () => {
  if (!db) return;
  await db.booking.deleteMany({ where: { listingId: { in: listingIds } } });
  await db.listing.deleteMany({ where: { id: { in: listingIds } } });
  await db.upload.deleteMany({
    where: { ownerId: { in: users.map((u) => u.id) } },
  });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  for (const key of photoKeys)
    await unlink(path.resolve(".local/uploads", key)).catch(() => {});
  await db.$disconnect();
});

async function login(page: Page, user: FixtureUser) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(user.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator(".dashboard-editorial-hero")).toBeVisible();
}

async function assertNoBodyOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

async function assertMetric(metrics: Locator, name: string, value: string) {
  const metric = metrics.locator(".dashboard-metric").filter({ hasText: name });
  await expect(metric).toHaveCount(1);
  // Count-up begins when the metric enters the viewport, as it does for a user.
  await metric.scrollIntoViewIfNeeded();
  await expect(
    metric.locator('.dashboard-metric-value > span[aria-hidden="true"]'),
  ).toHaveText(value);
}

async function assertMetricLayout(metrics: Locator) {
  for (const metric of await metrics.locator(".dashboard-metric").all()) {
    const label = (await metric.locator("dt").boundingBox())!;
    const value = (await metric
      .locator(".dashboard-metric-value")
      .boundingBox())!;
    const hint = (await metric
      .locator(".dashboard-metric-hint")
      .boundingBox())!;
    // Labels, values and supporting copy must form a readable vertical stack,
    // even when the surrounding metric row becomes a mobile grid.
    expect(value.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    expect(hint.y).toBeGreaterThanOrEqual(value.y + value.height - 1);
  }
}

async function dashboardScreenshot(page: Page, filename: string) {
  for (const image of await page.locator(".dashboard img").all()) {
    // The hero intentionally drifts continuously; native scrolling avoids
    // requiring that ornamental image to stop moving before a QA capture.
    await image.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect
      .poll(() =>
        image.evaluate(
          (element) =>
            (element as HTMLImageElement).complete &&
            (element as HTMLImageElement).naturalWidth > 0,
        ),
      )
      .toBe(true);
  }
  await page
    .locator(".wardrobe-rail")
    .evaluateAll((rails) =>
      rails.forEach((rail) => rail.scrollTo({ left: 0, behavior: "instant" })),
    );
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await mkdir(path.resolve(".local/qa"), { recursive: true });
  await page.screenshot({
    path: path.resolve(".local/qa", filename),
    fullPage: true,
  });
}

test("lender dashboard presents persisted metrics, closet activity, spotlight and existing controls", async ({
  page,
}) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, users[0]);
  const renting = page.getByRole("tab", { name: /I’m renting/ });
  const lending = page.getByRole("tab", { name: /I’m lending/ });
  const pieces = page.getByRole("tab", { name: /My pieces/ });
  const updates = page.getByRole("tab", { name: "Updates", exact: true });
  await renting.focus();
  await page.keyboard.press("ArrowRight");
  await expect(lending).toBeFocused();
  await expect(lending).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#wardrobe-panel")).toHaveAttribute(
    "aria-labelledby",
    "tab-incoming",
  );
  await page.keyboard.press("ArrowRight");
  await expect(pieces).toBeFocused();
  await expect(pieces).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(updates).toBeFocused();
  await expect(updates).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(renting).toBeFocused();
  await expect(renting).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /I’m lending/ }).click();
  const metrics = page.locator(".dashboard-editorial-metrics");
  await assertMetric(metrics, "Released earnings", "£250.00");
  await assertMetric(metrics, "Published pieces", "5");
  await assertMetric(metrics, "Confirmed rentals", "5");
  await assertMetric(metrics, "Booking conversion", "71%");
  await assertMetric(metrics, "Community rating", "4.5 / 5");
  await assertMetricLayout(metrics);
  await expect(page.locator(".closet-activity")).toContainText(
    "A new rental request",
  );
  await expect(page.locator(".closet-activity")).toContainText(
    "Rental settled · lender transfer confirmed",
  );
  await expect(page.locator(".closet-activity")).toContainText(
    "Earnings transferred",
  );
  await expect(page.locator(".closet-activity")).not.toContainText(
    "Item viewed",
  );
  await expect(page.locator(".closet-activity")).not.toContainText(
    "Item saved",
  );
  const motion = page.locator(".dashboard-motion-toggle");
  await expect(motion).toBeVisible();
  await motion.click();
  await expect(motion).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".dashboard-editorial-hero")).toHaveAttribute(
    "data-motion",
    "paused",
  );
  expect(
    await page
      .locator(".dashboard-hero-image")
      .evaluate((image) => getComputedStyle(image).animationPlayState),
  ).toBe("paused");
  await motion.click();
  await expect(motion).toHaveAttribute("aria-pressed", "false");
  expect(
    await page
      .locator(".dashboard-hero-image")
      .evaluate((image) => getComputedStyle(image).animationPlayState),
  ).toBe("running");
  const garment = page.locator(".wardrobe-rail .garment-card").first();
  await expect(garment.locator(".garment-image-secondary")).toHaveCount(0);
  await garment.locator(".listing-card").hover();
  await expect(garment.locator(".garment-image-secondary")).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(garment.locator(".garment-image-secondary")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(garment.locator(".listing-card-bottom")).toContainText("£25.00");
  await dashboardScreenshot(page, "dashboard-lender-desktop.png");
  await page.getByRole("tab", { name: /My pieces/ }).click();
  await expect(page.locator(".own-listing")).toHaveCount(7);
  const first = page
    .locator(".own-listing")
    .filter({ hasText: `${prefix} silk piece 1` });
  await expect(
    first.getByRole("link", { name: "Edit & availability" }),
  ).toHaveAttribute("href", `/list?edit=${listingIds[0]}`);
  await expect(
    first.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /Active rentals/ }).click();
  await expect(page.locator("#wardrobe-panel .booking-row")).toHaveCount(3);
  await assertMetric(metrics, "Released earnings", "£250.00");
  await page.getByRole("tab", { name: "Updates", exact: true }).click();
  await expect(
    page
      .locator("#wardrobe-panel")
      .getByText("Your test wardrobe received a genuine persisted request."),
  ).toBeVisible();
  await assertMetric(metrics, "Released earnings", "£250.00");
  await renting.click();
  await assertMetric(metrics, "Active rentals", "0");
  await expect(
    metrics
      .locator(".dashboard-metric")
      .filter({ hasText: "Released earnings" }),
  ).toHaveCount(0);
  const spotlight = page.locator(".creator-spotlight");
  await expect(spotlight).toBeVisible();
  const target = await spotlight
    .getByRole("link", { name: "Explore closet", exact: false })
    .getAttribute("href");
  expect(target).toMatch(/^\/members\/[a-zA-Z0-9]+$/);
  await spotlight
    .getByRole("link", { name: "Explore closet", exact: false })
    .click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));
  const featuredUser = users.find((user) => target === `/members/${user.id}`);
  expect(featuredUser).toBeTruthy();
  await expect(page.locator(".profile-hero h1")).toHaveText(featuredUser!.name);
  await assertNoBodyOverflow(page);
  expect(exceptions).toEqual([]);
});

test("renter saves garments with keyboard, retains them on this device and browses responsive rails", async ({
  page,
}, testInfo) => {
  const exceptions: string[] = [];
  page.on("pageerror", (error) => exceptions.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page, users[1]);
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Active rentals",
    "2",
  );
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Upcoming returns",
    "1",
  );
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Rental activity",
    "7",
  );
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "0",
  );
  const discovery = page.locator(".wardrobe-rail-section").filter({
    has: page.getByRole("heading", { name: "A new wardrobe awaits" }),
  });
  const rail = discovery.locator(".wardrobe-rail");
  await expect(rail).toBeVisible();
  const save = rail.locator(".garment-card").first().locator(".garment-save");
  const garmentLabel = await save.getAttribute("aria-label");
  expect(garmentLabel).toBeTruthy();
  const originalTitle = garmentLabel!
    .replace(/^Save /, "")
    .replace(/ on this device$/, "");
  const before = page.url();
  await save.focus();
  await page.keyboard.press("Space");
  await expect(save).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).toBe(before);
  expect(await save.evaluate((element) => element.closest("a") === null)).toBe(
    true,
  );
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "1",
  );
  await page.reload();
  await expect(page.locator(".dashboard-editorial-hero")).toBeVisible();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "1",
  );
  await expect(
    page.getByText("Saved on this device", { exact: false }).first(),
  ).toBeVisible();
  const otherPage = await page.context().newPage();
  await otherPage.goto("/dashboard");
  const otherRail = otherPage.locator(".wardrobe-rail-section").filter({
    has: otherPage.getByRole("heading", { name: "A new wardrobe awaits" }),
  });
  const otherLabel = await otherRail
    .getByRole("button", { name: /^Save / })
    .first()
    .getAttribute("aria-label");
  const otherTitle = otherLabel!
    .replace(/^Save /, "")
    .replace(/ on this device$/, "");
  const otherSave = otherRail
    .locator(".garment-card")
    .filter({
      has: otherPage.getByRole("heading", { name: otherTitle, exact: true }),
    })
    .locator(".garment-save");
  await otherSave.click();
  await expect(otherSave).toHaveAttribute("aria-pressed", "true");
  await page.bringToFront();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "2",
  );
  await otherPage.bringToFront();
  await assertMetric(
    otherPage.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "2",
  );
  await otherSave.click();
  await expect(otherSave).toHaveAttribute("aria-pressed", "false");
  await page.bringToFront();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "1",
  );
  // Remove the first tab's saved garment in the second tab. Its old success
  // feedback must disappear along with its pressed heart and saved count.
  await otherPage.bringToFront();
  const originalOther = otherRail
    .locator(".garment-card")
    .filter({
      has: otherPage.getByRole("heading", { name: originalTitle, exact: true }),
    })
    .locator(".garment-save");
  await originalOther.click();
  await expect(originalOther).toHaveAttribute("aria-pressed", "false");
  await page.bringToFront();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "0",
  );
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await expect(
    rail.locator(".garment-card").first().locator(".garment-save-note"),
  ).toHaveText("");
  await save.click();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "1",
  );
  await otherPage.close();
  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoBodyOverflow(page);
    await assertMetricLayout(page.locator(".dashboard-editorial-metrics"));
    const track = discovery.locator(".wardrobe-rail");
    expect(
      await track.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    if (width === 1280) {
      await track.scrollIntoViewIfNeeded();
      await track.hover();
      await page.mouse.wheel(550, 0);
      await expect
        .poll(() => track.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      await track.evaluate((element) =>
        element.scrollTo({ left: 0, behavior: "instant" }),
      );
    }
    await track.evaluate((element) =>
      element.scrollTo({ left: element.scrollWidth, behavior: "instant" }),
    );
    expect(
      await track.evaluate((element) => element.scrollLeft),
    ).toBeGreaterThan(0);
    await track.evaluate((element) =>
      element.scrollTo({ left: 0, behavior: "instant" }),
    );
    await expect(page.locator(".dashboard-editorial-hero")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`renter-dashboard-${width}.png`),
      fullPage: true,
    });
    if (width === 390)
      await dashboardScreenshot(page, "dashboard-renter-mobile.png");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, users[2]);
  await page.getByRole("tab", { name: /I’m renting/ }).click();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "0",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, users[1]);
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "1",
  );
  expect(exceptions).toEqual([]);
});

test("mobile touch swipes the wardrobe rail while the page stays within its viewport", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await login(page, users[0]);
    const rail = page.locator(".wardrobe-rail").first();
    await rail.scrollIntoViewIfNeeded();
    expect(
      await rail.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    const bounds = (await rail.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const y = Math.max(40, Math.min(760, bounds.y + 160));
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 320, y }],
    });
    for (const x of [265, 210, 155, 100, 55]) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y }],
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(() => rail.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    await assertNoBodyOverflow(page);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.screenshot({
      path: testInfo.outputPath("lender-mobile-touch.png"),
      fullPage: true,
    });
    await cdp.detach();
  } finally {
    await context.close();
  }
});

test("denied browser storage reports an honest save error and leaves rental controls usable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith("avielle:saved-wardrobe:"))
        throw new DOMException(
          "Storage denied by browser test",
          "QuotaExceededError",
        );
      return setItem.call(this, key, value);
    };
  });
  await login(page, users[1]);
  const save = page
    .locator(".wardrobe-rail")
    .first()
    .getByRole("button", { name: /^Save / })
    .first();
  await save.click();
  await expect(
    page
      .getByText(
        "This browser could not save the piece. Check its storage settings and try again.",
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  await expect(save).toHaveAttribute("aria-pressed", "false");
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Saved pieces",
    "0",
  );
  await page.getByRole("tab", { name: /Active rentals/ }).click();
  await expect(page.locator("#wardrobe-panel .booking-row")).toHaveCount(3);
});

test("reduced motion leaves dashboard values static and disables ornamental animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, users[0]);
  await page.getByRole("tab", { name: /I’m lending/ }).click();
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Released earnings",
    "£250.00",
  );
  await assertMetric(
    page.locator(".dashboard-editorial-metrics"),
    "Published pieces",
    "5",
  );
  const motion = await page.locator(".dashboard").evaluate((dashboard) => ({
    active: dashboard
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running").length,
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    hero: [...dashboard.querySelectorAll(".dashboard-editorial-hero img")].map(
      (image) => getComputedStyle(image).animationName,
    ),
  }));
  expect(motion.active).toBe(0);
  expect(motion.scroll).not.toBe("smooth");
  expect(motion.hero.every((name) => name === "none")).toBe(true);
  await assertNoBodyOverflow(page);
});
