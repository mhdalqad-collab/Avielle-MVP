import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { User } from "@prisma/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
test("persistent profiles, availability, deletion and notifications", { skip: !databaseUrl ? "Set TEST_DATABASE_URL to an isolated PostgreSQL test database." : false }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const target = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.match(decodeURIComponent(target.pathname.slice(1)), /(^|[_-])test($|[_-])/i, "Feature tests require a database with a test name.");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  const { db } = await import("../lib/db");
  const features = await import("../lib/features");
  const notices = await import("../lib/notifications");
  const market = await import("../lib/marketplace");
  const { HttpError } = await import("../lib/http");
  const future = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const rejectsStatus = (operation: Promise<unknown>, status: number) => assert.rejects(operation, (error: unknown) => error instanceof HttpError && error.status === status);

  async function fixture(run: (context: { owner: User; renter: User; stranger: User; listingId: string; prefix: string }) => Promise<void>) {
    const prefix = `features_${randomUUID().replaceAll("-", "")}`;
    const ids = ["owner", "renter", "stranger"].map((role) => `${prefix}_${role}`);
    try {
      await db.user.createMany({ data: ids.map((id) => ({ id, email: `${id}@example.invalid`, name: id, passwordHash: "TEST_ONLY_NO_VALID_LOGIN", emailVerifiedAt: new Date() })) });
      const records = await db.user.findMany({ where: { id: { in: ids } } });
      const [owner, renter, stranger] = ids.map((id) => records.find((record) => record.id === id)!);
      const listing = await db.listing.create({ data: {
        ownerId: owner.id, title: `${prefix} fixture dress`, description: "A garment fixture kept only in the isolated test database.",
        brand: "Fixture", category: "Dresses", size: "M", condition: "Good", location: "Test city", dailyRate: 1000,
        images: [], availableFrom: future(0), availableTo: future(90), status: "ACTIVE",
      } });
      await run({ owner, renter, stranger, listingId: listing.id, prefix });
    } finally {
      const listings = await db.listing.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
      await db.booking.deleteMany({ where: { listingId: { in: listings.map((listing) => listing.id) } } });
      await db.listing.deleteMany({ where: { ownerId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
  try {
    await t.test("profiles persist public fields, protect identity fields and show only received reviews", async () => fixture(async ({ owner, renter, listingId }) => {
      const updated = await features.updateProfile(owner, { name: "Updated lender", bio: "I lend occasion wear.", location: "London" });
      assert.equal(updated.bio, "I lend occasion wear.");
      assert.equal((await features.getProfile(owner)).name, "Updated lender");
      await assert.rejects(features.updateProfile(owner, { name: "Intruder", bio: "", location: "", role: "ADMIN" }));
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).role, "MEMBER");
      const booking = await market.requestBooking(renter, { listingId, startDate: future(1), endDate: future(2) });
      await db.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });
      await db.review.createMany({ data: [
        { bookingId: booking.id, authorId: renter.id, rating: 5, comment: "Helpful lender and accurate piece." },
        { bookingId: booking.id, authorId: owner.id, rating: 4, comment: "Careful renter." },
      ] });
      const publicProfile = await features.getMemberProfile(owner.id);
      assert.equal(publicProfile.bio, "I lend occasion wear.");
      assert.equal(publicProfile.reviews.length, 1);
      assert.equal(publicProfile.reviews[0].author.id, renter.id);
      assert.equal(publicProfile.reviews[0].rating, 5);
      assert.ok(!JSON.stringify(publicProfile).includes(owner.email));
      assert.ok(!JSON.stringify(publicProfile).includes("passwordHash"));
      assert.equal((await features.getMemberProfile(renter.id)).reviews[0].author.id, owner.id);
      await db.user.update({ where: { id: owner.id }, data: { active: false } });
      await rejectsStatus(features.getMemberProfile(owner.id), 404);
    }));

    await t.test("owner blackout dates exclude bookings and search and cannot overwrite reservations", async () => fixture(async ({ owner, renter, stranger, listingId, prefix }) => {
      await rejectsStatus(features.addAvailabilityBlock(listingId, stranger, { startDate: future(5), endDate: future(6) }), 404);
      await rejectsStatus(features.addAvailabilityBlock(listingId, owner, { startDate: future(80), endDate: future(91) }), 400);
      const block = await features.addAvailabilityBlock(listingId, owner, { startDate: future(5), endDate: future(6) });
      assert.deepEqual((await features.getAvailability(listingId, null)).blockedDates, [{ startDate: future(5), endDate: future(6) }]);
      await rejectsStatus(features.addAvailabilityBlock(listingId, owner, { startDate: future(6), endDate: future(7) }), 409);
      await rejectsStatus(market.requestBooking(renter, { listingId, startDate: future(5), endDate: future(6) }), 409);
      assert.equal((await market.getListings(new URLSearchParams({ q: prefix, dateFrom: future(5), dateTo: future(6) }))).length, 0);
      await rejectsStatus(features.removeAvailabilityBlock(listingId, stranger, block.id), 404);
      await features.removeAvailabilityBlock(listingId, owner, block.id);
      assert.equal((await features.getAvailability(listingId, null)).blocks.length, 0);
      await market.requestBooking(renter, { listingId, startDate: future(5), endDate: future(6) });
      await rejectsStatus(features.addAvailabilityBlock(listingId, owner, { startDate: future(6), endDate: future(8) }), 409);
      const availability = await features.getAvailability(listingId, null);
      assert.equal(availability.blocks.length, 0);
      assert.equal(availability.blockedDates.length, 1);
      assert.ok(!JSON.stringify(availability).includes(renter.id));
    }));

    await t.test("soft deletion blocks open rentals and preserves completed booking history", async () => fixture(async ({ owner, renter, stranger, listingId, prefix }) => {
      await rejectsStatus(features.deleteListing(listingId, stranger), 404);
      const booking = await market.requestBooking(renter, { listingId, startDate: future(1), endDate: future(2) });
      await rejectsStatus(features.deleteListing(listingId, owner), 409);
      await db.booking.update({ where: { id: booking.id }, data: { status: "COMPLETED" } });
      const deleted = await features.deleteListing(listingId, owner);
      assert.equal(deleted.status, "DELETED");
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).listingId, listingId);
      await rejectsStatus(market.getListing(listingId, renter), 404);
      assert.equal((await market.getListings(new URLSearchParams({ q: prefix }))).length, 0);
      assert.equal((await features.getMemberProfile(owner.id)).listings.length, 0);
      assert.equal((await market.getBooking(booking.id, renter)).listing.id, listingId);
      await rejectsStatus(market.updateListing(listingId, owner, { action: "resubmit" }), 409);
      await rejectsStatus(features.addAvailabilityBlock(listingId, owner, { startDate: future(10), endDate: future(11) }), 409);
    }));

    await t.test("racing owner blackouts and renter requests reserve dates exactly once", { skip: target.port === "55432" ? "PGlite cannot verify independent PostgreSQL sessions; run on native PostgreSQL." : false }, async () => fixture(async ({ owner, renter, listingId }) => {
      const dates = { startDate: future(10), endDate: future(11) };
      const outcomes = await Promise.allSettled([
        features.addAvailabilityBlock(listingId, owner, dates),
        market.requestBooking(renter, { listingId, ...dates }),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
      const rejected = outcomes.find((outcome) => outcome.status === "rejected") as PromiseRejectedResult;
      assert.ok(rejected.reason instanceof HttpError);
      assert.equal(rejected.reason.status, 409);
      const bookings = await db.booking.count({ where: { listingId } });
      const blocks = await db.listingBlock.count({ where: { listingId } });
      assert.equal(bookings + blocks, 1);
    }));

    await t.test("notifications are transactional, participant scoped and privately acknowledged", async () => fixture(async ({ owner, renter, stranger, listingId }) => {
      const booking = await market.requestBooking(renter, { listingId, startDate: future(1), endDate: future(2) });
      await db.notification.deleteMany({ where: { bookingId: booking.id } });
      await db.$transaction((tx) => notices.notifyBooking(tx, booking.id, renter.id, "Request received", "Review the rental request."));
      const ownerNotices = await notices.getNotifications(owner.id);
      assert.equal(ownerNotices.unreadCount, 1);
      assert.equal(ownerNotices.notifications[0].bookingId, booking.id);
      assert.equal((await notices.getNotifications(renter.id)).unreadCount, 0);
      assert.equal((await notices.getNotifications(stranger.id)).notifications.length, 0);
      await rejectsStatus(notices.markNotificationsRead(stranger.id, { id: ownerNotices.notifications[0].id }), 404);
      assert.equal((await notices.markNotificationsRead(owner.id, { id: ownerNotices.notifications[0].id })).unreadCount, 0);
      await assert.rejects(db.$transaction(async (tx) => {
        await notices.notifyBooking(tx, booking.id, owner.id, "Rolled back", "Must not survive.");
        throw new Error("Deliberate rollback");
      }), /Deliberate rollback/);
      assert.equal((await notices.getNotifications(renter.id)).notifications.length, 0);
      await db.$transaction((tx) => notices.notifyBooking(tx, booking.id, "SYSTEM", "Payment confirmed", "Both participants receive this."));
      assert.equal((await notices.getNotifications(owner.id)).unreadCount, 1);
      assert.equal((await notices.getNotifications(renter.id)).unreadCount, 1);
      assert.equal((await notices.markNotificationsRead(owner.id, {})).unreadCount, 0);
      assert.equal((await notices.getNotifications(renter.id)).unreadCount, 1);
    }));
  } finally { await db.$disconnect(); }
});
