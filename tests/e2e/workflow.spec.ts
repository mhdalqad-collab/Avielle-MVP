import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

// Real browser + HTTP + PostgreSQL workflow. Only provider boundaries are test doubles:
// email-hook.cjs captures mail in the test server; FakeStripe stays in this worker.
// This does not certify a live Stripe Checkout page, real emails, S3 or bank payouts.
test("renter and lender complete the persistent rental lifecycle", async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const database = new URL(process.env.DATABASE_URL || "http://invalid");
  expect(["127.0.0.1", "localhost"]).toContain(database.hostname);
  expect(database.pathname).toMatch(/_e2e$/);
  expect(process.env.NODE_ENV).not.toBe("production");
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  const { db } = await import("../../lib/db");
  const prefix = `e2e_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const roles = ["owner", "renter", "admin", "outsider"] as const;
  const emails = roles.map((role) => `${prefix}_${role}@example.invalid`);
  const password = "Rental-test-passphrase-2026!";
  const changedPassword = "Changed-test-passphrase-2026!";
  const photo = path.resolve("public/images/hero.jpg");
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const runtimeErrors: string[] = [];
  const eventIds: string[] = [];
  const date = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  async function newPage() {
    const context = await browser.newContext({ baseURL: "http://localhost:3000" });
    contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    return page;
  }
  async function capturedLink(email: string, route: string) {
    const filename = path.resolve(".local/e2e-mail", `${Buffer.from(email).toString("hex")}.json`);
    let message = "";
    await expect.poll(async () => {
      try { const mail = JSON.parse(await readFile(filename, "utf8")); message = mail.text || mail.html || ""; }
      catch { return false; }
      return message.includes(`/${route}?token=`);
    }, { timeout: 15_000 }).toBe(true);
    const match = message.match(new RegExp(`http://localhost:3000/${route}\\?token=[a-zA-Z0-9_-]+`));
    expect(match, `Captured ${route} email must contain a usable local link`).not.toBeNull();
    return match![0];
  }
  async function register(page: Page, email: string, name: string) {
    await page.goto("/register");
    await page.getByLabel("Your name").fill(name);
    await page.getByLabel("Email address").fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create my account" }).click();
    await expect(page.getByText("Your account is created.", { exact: false })).toBeVisible();
    await page.goto("/list");
    await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await page.goto(await capturedLink(email, "verify-email"));
    await page.getByRole("button", { name: "Confirm my email" }).click();
    await expect(page.getByText("Your email is verified.", { exact: false })).toBeVisible();
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
    return user;
  }
  async function login(page: Page, email: string, secret: string) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(email);
    await page.locator('input[name="password"]').fill(secret);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
  async function waitStatus(page: Page, value: string) {
    await expect(page.locator(`.booking-summary .status-${value.toLowerCase()}`)).toBeVisible();
  }
  async function requestRental(page: Page, listingId: string, start: string, end: string) {
    await page.goto(`/items/${listingId}`);
    await page.getByLabel("Pickup date", { exact: true }).fill(start);
    await page.getByLabel("Return date", { exact: true }).fill(end);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request to rent" }).click();
    await expect(page).toHaveURL(/\/bookings\/[a-zA-Z0-9]+$/);
    await waitStatus(page, "REQUESTED");
    return page.url().split("/").pop()!;
  }
  async function evidence(page: Page, phase: string, notes: string) {
    await page.getByLabel("Report stage").selectOption(phase);
    await page.getByLabel("Upload photos").setInputFiles(photo);
    await expect(page.getByAltText("Condition photo 1", { exact: true })).toBeVisible();
    await page.getByLabel("Condition notes").fill(notes);
    await page.getByRole("button", { name: "Save condition report" }).click();
    await expect(page.getByText(notes, { exact: true })).toBeVisible();
    await expect(page.getByText("Condition report saved.", { exact: true })).toBeVisible();
  }
  try {
    const ownerPage = await newPage(), renterPage = await newPage(), adminPage = await newPage(), outsiderPage = await newPage();
    const owner = await test.step("Lender signs up, verifies email, logs out/in and resets password", async () => {
      const user = await register(ownerPage, emails[0], "E2E Lender");
      await ownerPage.goto("/dashboard");
      await ownerPage.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect.poll(async () => (await (await ownerPage.request.get("/api/auth")).json()).user).toBeNull();
      await login(ownerPage, emails[0], password);
      const oldCookies = await ownerPage.context().cookies();
      await ownerPage.goto("/forgot-password");
      await ownerPage.getByLabel("Email address").fill(emails[0]);
      await ownerPage.getByRole("button", { name: "Send reset link" }).click();
      await expect(ownerPage.getByText("If an account exists for that email", { exact: false })).toBeVisible();
      await ownerPage.goto(await capturedLink(emails[0], "reset-password"));
      await ownerPage.locator('input[name="password"]').fill(changedPassword);
      await ownerPage.getByRole("button", { name: "Save new password" }).click();
      await expect(ownerPage.getByText("Your password has been updated.", { exact: false })).toBeVisible();
      const previous = await outsiderPage.request.get("/api/auth", { headers: { Cookie: oldCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") } });
      expect((await previous.json()).user).toBeNull();
      await login(ownerPage, emails[0], changedPassword);
      return user;
    });
    const renter = await test.step("Renter signs up and verifies email", () => register(renterPage, emails[1], "E2E Renter"));
    const admin = await register(adminPage, emails[2], "E2E Operations");
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
    await register(outsiderPage, emails[3], "E2E Outsider");
    await test.step("Both roles persist public profiles without exposing email", async () => {
      for (const [page, user, name] of [[ownerPage, owner, "E2E Lender Updated"], [renterPage, renter, "E2E Renter Updated"]] as const) {
        await page.goto("/profile");
        await page.getByLabel("Display name").fill(name);
        await page.getByLabel("Your area", { exact: false }).fill("London");
        await page.getByLabel("Introduce yourself").fill("I enjoy thoughtfully sharing occasion wear.");
        await page.getByRole("button", { name: "Save profile" }).click();
        await expect(page.getByText("Your profile is saved.", { exact: true })).toBeVisible();
        await page.getByRole("link", { name: "View public profile" }).click();
        await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
        const publicData = await (await outsiderPage.request.get(`/api/members/${user.id}`)).json();
        expect(JSON.stringify(publicData)).not.toContain(user.email);
        expect(JSON.stringify(publicData)).not.toContain("passwordHash");
      }
    });
    const listingId = await test.step("Lender uploads a real photo, creates, edits and blocks listing dates", async () => {
      await ownerPage.goto("/list");
      await ownerPage.getByLabel("Upload photos").setInputFiles(photo);
      await expect(ownerPage.getByAltText("Listing photo 1", { exact: true })).toBeVisible();
      await ownerPage.getByLabel("Listing title").fill(`${prefix} silk dress`);
      await ownerPage.getByLabel("Brand", { exact: true }).fill("E2E designer");
      await ownerPage.getByLabel("Category", { exact: true }).selectOption("Dresses");
      await ownerPage.getByLabel("Label size").fill("M");
      await ownerPage.getByLabel("Condition", { exact: true }).selectOption("Excellent");
      await ownerPage.getByLabel("Measurements & fit", { exact: false }).fill("Bust 90 cm, length 120 cm.");
      await ownerPage.getByLabel("Description & care").fill("An accurately described test garment. Hand wash gently and return clean.");
      await ownerPage.getByLabel("Pickup area", { exact: false }).fill("London");
      await ownerPage.locator('[name="dailyRate"]').fill("25");
      await ownerPage.locator('[name="cleaningFee"]').fill("5");
      await ownerPage.locator('[name="deposit"]').fill("100");
      await ownerPage.getByLabel("Available from").fill(date(0));
      await ownerPage.getByLabel("Available until").fill(date(60));
      await ownerPage.getByRole("checkbox").check();
      await ownerPage.getByRole("button", { name: "Submit for review", exact: true }).click();
      await expect(ownerPage).toHaveURL(/\/dashboard\?created=1$/);
      const listing = await db.listing.findFirstOrThrow({ where: { ownerId: owner.id } });
      expect(listing.status).toBe("PENDING");
      expect(listing.images).toHaveLength(1);
      expect((await outsiderPage.request.get(`/api/listings/${listing.id}`)).status()).toBe(404);
      await ownerPage.goto(`/list?edit=${listing.id}`);
      await ownerPage.getByLabel("Listing title").fill(`${prefix} edited silk dress`);
      await ownerPage.getByRole("checkbox").check();
      await ownerPage.getByRole("button", { name: "Save & submit for review" }).click();
      await expect(ownerPage).toHaveURL(/\/dashboard\?updated=1$/);
      await ownerPage.goto(`/list?edit=${listing.id}`);
      await ownerPage.getByLabel("Block from").fill(date(10));
      await ownerPage.getByLabel("Block until").fill(date(11));
      await ownerPage.getByRole("button", { name: "Block these dates" }).click();
      await expect(ownerPage.getByRole("button", { name: "Remove block" })).toBeVisible();
      await ownerPage.getByRole("button", { name: "Remove block" }).click();
      await expect(ownerPage.getByText("No personal date blocks yet.")).toBeVisible();
      await ownerPage.getByLabel("Block from").fill(date(10));
      await ownerPage.getByLabel("Block until").fill(date(11));
      await ownerPage.getByRole("button", { name: "Block these dates" }).click();
      await expect(ownerPage.getByRole("button", { name: "Remove block" })).toBeVisible();
      return listing.id;
    });
    await test.step("Operations publishes and renter searches filters and blocked dates", async () => {
      await adminPage.goto("/dashboard");
      await adminPage.getByRole("tab", { name: /Operations/ }).click();
      const card = adminPage.locator(".moderation-card").filter({ hasText: `${prefix} edited silk dress` });
      await card.getByLabel("Moderation note").fill("Photograph and description reviewed in isolated E2E test.");
      await card.getByRole("button", { name: "Approve & publish" }).click();
      await expect(adminPage.getByText("Listing approved and published.")).toBeVisible();
      await renterPage.goto("/explore");
      await renterPage.getByLabel("Search the wardrobe").fill(prefix);
      await renterPage.getByRole("button", { name: "Filters", exact: true }).click();
      await renterPage.getByLabel("Category", { exact: true }).selectOption("Dresses");
      await renterPage.getByLabel("Size", { exact: true }).fill("M");
      await renterPage.getByLabel("Pickup area", { exact: true }).fill("London");
      await renterPage.getByRole("button", { name: "Search", exact: true }).click();
      await expect(renterPage.getByRole("heading", { name: `${prefix} edited silk dress`, exact: true })).toBeVisible();
      await renterPage.locator(`a.listing-card[href="/items/${listingId}"]`).click();
      await renterPage.getByLabel("Pickup date", { exact: true }).fill(date(10));
      await renterPage.getByLabel("Return date", { exact: true }).fill(date(11));
      await expect(renterPage.getByText("These dates overlap another reservation.", { exact: false })).toBeVisible();
      await expect(renterPage.getByRole("button", { name: "Request to rent" })).toBeDisabled();
    });
    await test.step("Lender declines a request without collecting payment", async () => {
      const declined = await requestRental(renterPage, listingId, date(5), date(6));
      await ownerPage.goto(`/bookings/${declined}`);
      await ownerPage.getByRole("button", { name: "Decline request" }).click();
      await waitStatus(ownerPage, "DECLINED");
      await renterPage.reload(); await waitStatus(renterPage, "DECLINED");
      expect((await db.booking.findUniqueOrThrow({ where: { id: declined } })).paymentStatus).toBe("UNPAID");
    });
    const bookingId = await test.step("Renter requests current dates, lender accepts, private conversation persists", async () => {
      const id = await requestRental(renterPage, listingId, date(0), date(1));
      expect((await outsiderPage.request.get(`/api/bookings/${id}`)).status()).toBe(404);
      await ownerPage.goto("/dashboard");
      await ownerPage.getByRole("tab", { name: /I’m lending/ }).click();
      await ownerPage.locator(`a.booking-row[href="/bookings/${id}"]`).click();
      await ownerPage.getByRole("button", { name: "Accept request" }).click();
      await waitStatus(ownerPage, "APPROVED");
      await renterPage.reload(); await waitStatus(renterPage, "APPROVED");
      await renterPage.getByLabel("Message", { exact: true }).fill("Could we arrange local pickup at noon?");
      await renterPage.getByRole("button", { name: "Send message" }).click();
      await expect(renterPage.getByText("Message sent.", { exact: true })).toBeVisible();
      await ownerPage.getByRole("button", { name: "Refresh status" }).click();
      await expect(ownerPage.getByText("Could we arrange local pickup at noon?", { exact: true })).toBeVisible();
      await ownerPage.getByLabel("Message", { exact: true }).fill("Noon is confirmed. Please use the agreed collection point.");
      await ownerPage.getByRole("button", { name: "Send message" }).click();
      await expect(ownerPage.getByText("Message sent.", { exact: true })).toBeVisible();
      return id;
    });

    // Injected provider is confined to this test worker; the browser must still see
    // an honest 503 when the real server has no configured payment credentials.
    const { FakeStripe } = await import("../helpers/fake-stripe");
    const fake = new FakeStripe(prefix, `acct_${prefix}`);
    const payments = await import("../../lib/payments");
    await test.step("Checkout reports unconfigured service; isolated provider confirms persisted payment", async () => {
      await renterPage.getByRole("checkbox").check();
      const response = renterPage.waitForResponse((r) => r.url().endsWith("/api/payments/checkout") && r.request().method() === "POST");
      await renterPage.getByRole("button", { name: "Continue to secure checkout" }).click();
      expect((await response).status()).toBe(503);
      await expect(renterPage.getByRole("alert").filter({ hasText: "Online payments are not available yet" })).toBeVisible();
      // The test helper supplies an eligible Connect account and fake Stripe records.
      await db.user.update({ where: { id: owner.id }, data: { stripeAccountId: fake.accountId, payoutsEnabled: true } });
      await payments.checkout(bookingId, await db.user.findUniqueOrThrow({ where: { id: renter.id } }), fake.client);
      const pending = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(pending.status).toBe("CHECKOUT_PENDING");
      const event = fake.pay(pending.stripeSessionId!);
      eventIds.push(event.id);
      await payments.handleStripeEvent(event, fake.client);
      await renterPage.reload(); await waitStatus(renterPage, "CONFIRMED");
      await ownerPage.reload(); await waitStatus(ownerPage, "CONFIRMED");
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).paymentStatus).toBe("PAID");
    });
    await test.step("Before/after uploads, active rental, return and settlement retain private evidence", async () => {
      await expect(ownerPage.getByRole("button", { name: "Confirm handover" })).toBeDisabled();
      await evidence(ownerPage, "BEFORE", "Lender before: no visible damage; seams and fastenings checked.");
      const report = await db.evidence.findFirstOrThrow({ where: { bookingId, authorId: owner.id, phase: "BEFORE" } });
      expect((await outsiderPage.request.get(report.photos[0])).status()).toBe(404);
      expect((await renterPage.request.get(report.photos[0])).status()).toBe(200);
      await ownerPage.getByRole("button", { name: "Confirm handover" }).click();
      await waitStatus(ownerPage, "IN_USE");
      await renterPage.goto("/dashboard");
      await renterPage.getByRole("tab", { name: /Active rentals/ }).click();
      await renterPage.locator(`a.booking-row[href="/bookings/${bookingId}"]`).click();
      await waitStatus(renterPage, "IN_USE");
      await evidence(renterPage, "BEFORE", "Renter before: condition matches listing and lender report.");
      await evidence(renterPage, "AFTER", "Renter after: returned clean, all closures intact, no new marks.");
      await renterPage.getByRole("button", { name: "I have returned the piece" }).click();
      await waitStatus(renterPage, "RETURNED");
      await ownerPage.reload(); await waitStatus(ownerPage, "RETURNED");
      await expect(ownerPage.getByRole("button", { name: "Accept return & settle payment" })).toBeDisabled();
      await evidence(ownerPage, "AFTER", "Lender after: inspected returned garment; no damage or missing parts.");
      const response = ownerPage.waitForResponse((r) => r.url().endsWith(`/api/bookings/${bookingId}`) && r.request().method() === "POST");
      await ownerPage.getByRole("button", { name: "Accept return & settle payment" }).click();
      expect((await response).status()).toBe(503);
      expect((await db.booking.findUniqueOrThrow({ where: { id: bookingId } })).status).toBe("SETTLING");
      await payments.settlePayment(bookingId, fake.client);
      const completed = await db.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(completed.status).toBe("COMPLETED");
      expect(completed.refundedAmount).toBe(completed.deposit);
      expect(completed.payoutStatus).toBe("TRANSFERRED");
      await ownerPage.reload(); await waitStatus(ownerPage, "COMPLETED");
      await expect(ownerPage.locator(".payment-record .status-transferred")).toBeVisible();
      await renterPage.reload(); await waitStatus(renterPage, "COMPLETED");
      await mkdir(".local/qa", { recursive: true });
      await ownerPage.screenshot({ path: ".local/qa/lender-completed-desktop.png", fullPage: true });
      await renterPage.setViewportSize({ width: 390, height: 844 });
      expect(await renterPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await renterPage.screenshot({ path: ".local/qa/renter-completed-mobile.png", fullPage: true });
    });
    await test.step("Both participants review; notifications are acknowledged; listing deletion keeps history", async () => {
      for (const [page, review] of [[ownerPage, "Careful renter; returned exactly as agreed."], [renterPage, "Accurate listing and helpful lender; lovely experience."]] as const) {
        await page.getByLabel("Rating", { exact: true }).selectOption("5");
        await page.getByLabel("Your review", { exact: true }).fill(review);
        await page.getByRole("button", { name: "Publish review" }).click();
        await expect(page.getByText("Your review is saved. Thank you.", { exact: true })).toBeVisible();
      }
      await renterPage.goto(`/items/${listingId}`);
      await expect(renterPage.getByText("Accurate listing and helpful lender; lovely experience.", { exact: true })).toBeVisible();
      await ownerPage.goto("/dashboard");
      await ownerPage.getByRole("tab", { name: "Updates", exact: true }).click();
      await expect(ownerPage.locator(".notification.unread").first()).toBeVisible();
      await ownerPage.getByRole("button", { name: "Mark all read" }).click();
      await expect(ownerPage.locator(".notification.unread")).toHaveCount(0);
      await ownerPage.getByRole("tab", { name: /My pieces/ }).click();
      const piece = ownerPage.locator(".own-listing").filter({ hasText: `${prefix} edited silk dress` });
      await piece.getByRole("button", { name: "Delete piece", exact: true }).click();
      await piece.getByRole("button", { name: "Confirm delete" }).click();
      await expect(ownerPage.getByText("Your piece was removed from the wardrobe.", { exact: true })).toBeVisible();
      expect((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe("DELETED");
      expect((await outsiderPage.request.get(`/api/listings/${listingId}`)).status()).toBe(404);
      await renterPage.goto(`/bookings/${bookingId}`); await waitStatus(renterPage, "COMPLETED");
      expect(await db.evidence.count({ where: { bookingId } })).toBe(4);
      expect(await db.review.count({ where: { bookingId } })).toBe(2);
      expect(await db.message.count({ where: { bookingId } })).toBe(2);
    });
    expect(runtimeErrors, "No browser runtime exceptions during renter/lender workflow").toEqual([]);
  } catch (error) {
    for (const [index, page] of pages.entries()) {
      if (!page.isClosed()) await testInfo.attach(`journey-page-${index}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" }).catch(() => {});
    }
    throw error;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    const uploads = await db.upload.findMany({ where: { ownerId: { in: ids } }, select: { key: true } });
    const listings = await db.listing.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
    await db.booking.deleteMany({ where: { listingId: { in: listings.map((listing) => listing.id) } } });
    await db.listing.deleteMany({ where: { ownerId: { in: ids } } });
    await db.upload.deleteMany({ where: { ownerId: { in: ids } } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.webhookEvent.deleteMany({ where: { id: { in: eventIds } } });
    for (const upload of uploads) if (/^[a-f0-9-]{36}\.webp$/.test(upload.key)) await unlink(path.resolve(".local/uploads", upload.key)).catch(() => {});
    for (const email of emails) await unlink(path.resolve(".local/e2e-mail", `${Buffer.from(email).toString("hex")}.json`)).catch(() => {});
    await db.$disconnect();
  }
});
