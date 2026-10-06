import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Prisma, User } from "@prisma/client";
import { ZodError } from "zod";

const databaseUrl = process.env.TEST_DATABASE_URL;
test("persisted lifecycle recovery and conversation history", { skip: !databaseUrl ? "Set TEST_DATABASE_URL to an isolated PostgreSQL test database." : false }, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const target = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.match(decodeURIComponent(target.pathname.slice(1)), /(^|[_-])test($|[_-])/i);
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  const { db } = await import("../lib/db");
  const market = await import("../lib/marketplace");
  const { HttpError } = await import("../lib/http");
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const rejectsStatus = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === status);

  async function fixture(run: (context: {
    owner: User; renter: User; stranger: User; admin: User; listingId: string;
    booking: (changes?: Partial<Prisma.BookingUncheckedCreateInput>) => ReturnType<typeof db.booking.create>;
  }) => Promise<void>) {
    const prefix = `lifecycle_${randomUUID().replaceAll("-", "")}`;
    const ids = ["owner", "renter", "stranger", "admin"].map((role) => `${prefix}_${role}`);
    try {
      await db.user.createMany({ data: ids.map((id, i) => ({ id, name: id, email: `${id}@example.invalid`, passwordHash: "TEST_ONLY_NOT_VALID", emailVerifiedAt: new Date(), role: i === 3 ? "ADMIN" : "MEMBER" })) });
      const users = await db.user.findMany({ where: { id: { in: ids } } });
      const [owner, renter, stranger, admin] = ids.map((id) => users.find((user) => user.id === id)!);
      const listing = await db.listing.create({ data: {
        ownerId: owner.id, title: `${prefix} piece`, description: "Isolated test garment for lifecycle recovery assertions.", brand: "Fixture", category: "Dresses", size: "M", condition: "Good", location: "Test city", dailyRate: 1000, images: [], availableFrom: day(-90), availableTo: day(90), status: "ACTIVE",
      } });
      const booking = (changes: Partial<Prisma.BookingUncheckedCreateInput> = {}) => db.booking.create({ data: {
        listingId: listing.id, renterId: renter.id, startDate: day(10), endDate: day(11), days: 2, rental: 2000, cleaningFee: 500, serviceFee: 160, deposit: 10000, total: 12660, ownerEarnings: 2140, status: "REQUESTED", paymentStatus: "UNPAID", expiresAt: new Date(Date.now() + 3600_000), ...changes,
      } });
      await run({ owner, renter, stranger, admin, listingId: listing.id, booking });
    } finally {
      await db.booking.deleteMany({ where: { listing: { ownerId: { in: ids } } } });
      await db.listing.deleteMany({ where: { ownerId: { in: ids } } });
      await db.upload.deleteMany({ where: { ownerId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
  }

  try {
    await t.test("authorized booking reads expire unpaid requests once and notify both participants", async () => fixture(async ({ owner, renter, stranger, booking }) => {
      const rental = await booking({ expiresAt: new Date(Date.now() - 60_000) });
      await rejectsStatus(market.getBooking(rental.id, stranger), 404);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: rental.id } })).status, "REQUESTED");
      assert.equal((await market.getBooking(rental.id, renter)).status, "EXPIRED");
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: rental.id } })).status, "EXPIRED");
      assert.equal((await market.getBooking(rental.id, owner)).status, "EXPIRED");
      assert.equal(await db.bookingEvent.count({ where: { bookingId: rental.id, type: "EXPIRED" } }), 1);
      const notices = await db.notification.findMany({ where: { bookingId: rental.id } });
      assert.deepEqual(notices.map((notice) => notice.userId).sort(), [owner.id, renter.id].sort());
      assert.ok(notices.every((notice) => notice.title === "expired" && notice.readAt === null));
    }));

    await t.test("dashboard reconciles all unpaid deadlines while keeping paid rentals active", async () => fixture(async ({ owner, renter, booking }) => {
      const expired = new Date(Date.now() - 60_000);
      const request = await booking({ expiresAt: expired });
      const checkout = await booking({ status: "CHECKOUT_PENDING", expiresAt: expired });
      const paid = await booking({ status: "CONFIRMED", paymentStatus: "PAID", expiresAt: expired });
      const dashboard = await market.dashboard(owner);
      assert.equal(dashboard.bookings.find((row) => row.id === request.id)?.status, "EXPIRED");
      assert.equal(dashboard.bookings.find((row) => row.id === checkout.id)?.status, "EXPIRED");
      assert.equal(dashboard.bookings.find((row) => row.id === paid.id)?.status, "CONFIRMED");
      await market.dashboard(renter);
      assert.equal(await db.notification.count({ where: { bookingId: { in: [request.id, checkout.id] } } }), 4);
      assert.equal(await db.notification.count({ where: { bookingId: paid.id } }), 0);
      assert.equal(await db.bookingEvent.count({ where: { bookingId: { in: [request.id, checkout.id] }, type: "EXPIRED" } }), 2);
    }));

    for (const deposit of [10000, 0]) {
      await t.test(`missing-return claim enforces dates, roles and a ${deposit} deposit cap without fabricated return evidence`, async () => fixture(async ({ owner, renter, stranger, admin, listingId, booking }) => {
        const rental = await booking({ status: "IN_USE", paymentStatus: "PAID", expiresAt: null, startDate: day(-2), endDate: day(0), deposit, total: 2660 + deposit });
        const claim = { action: "claim", kind: "NOT_RETURNED", description: "The garment has not been returned despite the agreed collection and return arrangement.", requestedAmount: deposit };
        await rejectsStatus(market.bookingAction(rental.id, owner, claim), 409);
        await db.booking.update({ where: { id: rental.id }, data: { endDate: day(-1) } });
        await rejectsStatus(market.bookingAction(rental.id, owner, claim), 400);
        await db.evidence.create({ data: { bookingId: rental.id, authorId: owner.id, phase: "BEFORE", photos: ["/api/media/test_before_record"], notes: "Original before-handover condition record." } });
        await rejectsStatus(market.bookingAction(rental.id, renter, claim), 403);
        await rejectsStatus(market.bookingAction(rental.id, stranger, claim), 404);
        await assert.rejects(market.bookingAction(rental.id, owner, { ...claim, requestedAmount: deposit + 1 }), ZodError);
        await assert.rejects(market.bookingAction(rental.id, owner, { ...claim, requestedAmount: -1 }), ZodError);
        assert.equal(await db.claim.count({ where: { bookingId: rental.id } }), 0);
        await market.bookingAction(rental.id, owner, claim);
        assert.equal((await market.getBooking(rental.id, renter)).status, "CLAIM_OPEN");
        assert.equal((await db.claim.findUniqueOrThrow({ where: { bookingId: rental.id } })).kind, "NOT_RETURNED");
        await rejectsStatus(market.bookingAction(rental.id, owner, { action: "complete" }), 409);
        const resolution = { action: "resolve", awardedAmount: deposit, resolution: "Operations reviewed the conversation and handover evidence and determined the bounded deposit award." };
        await rejectsStatus(market.bookingAction(rental.id, owner, resolution), 403);
        await rejectsStatus(market.bookingAction(rental.id, renter, resolution), 403);
        await assert.rejects(market.bookingAction(rental.id, admin, { ...resolution, awardedAmount: deposit + 1 }), ZodError);
        assert.equal((await db.claim.findUniqueOrThrow({ where: { bookingId: rental.id } })).status, "OPEN");
        await market.bookingAction(rental.id, admin, resolution);
        assert.equal((await market.getBooking(rental.id, renter)).status, "LOSS_RESOLVED");
        assert.equal((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).status, "PAUSED");
        assert.equal(await db.evidence.count({ where: { bookingId: rental.id, phase: "AFTER" } }), 0);
        await rejectsStatus(market.bookingAction(rental.id, renter, { action: "complete" }), 403);
        assert.deepEqual(await market.bookingAction(rental.id, owner, { action: "complete" }), { paymentWork: "settle" });
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: rental.id } })).status, "SETTLING");
        assert.equal(await db.evidence.count({ where: { bookingId: rental.id, phase: "AFTER" } }), 0);
        const persisted = await db.claim.findUniqueOrThrow({ where: { bookingId: rental.id } });
        assert.equal(persisted.awardedAmount, deposit);
        assert.equal(persisted.status, "RESOLVED");
      }));
    }

    await t.test("conversation returns the latest 200 messages in readable order while retaining history", async () => fixture(async ({ owner, renter, stranger, booking }) => {
      const rental = await booking();
      const start = Date.now() - 300_000;
      await db.message.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ bookingId: rental.id, senderId: i % 2 ? owner.id : renter.id, text: `Earlier message ${i}`, createdAt: new Date(start + i * 1000) })) });
      await market.bookingAction(rental.id, owner, { action: "message", text: "Most recent collection update." });
      await rejectsStatus(market.getBooking(rental.id, stranger), 404);
      const detail = await market.getBooking(rental.id, renter);
      assert.equal(detail.messages.length, 200);
      assert.equal(detail.messages[0].text, "Earlier message 6");
      assert.equal(detail.messages.at(-1)?.text, "Most recent collection update.");
      assert.ok(detail.messages.every((message, index) => index === 0 || detail.messages[index - 1].createdAt <= message.createdAt));
      assert.equal(await db.message.count({ where: { bookingId: rental.id } }), 206);
      const notifications = await db.notification.findMany({ where: { bookingId: rental.id, title: "New message" } });
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].userId, renter.id);
    }));
  } finally { await db.$disconnect(); }
});
