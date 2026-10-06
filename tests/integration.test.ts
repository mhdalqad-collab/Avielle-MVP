import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { User } from "@prisma/client";
import { dateSchema, quote, rentalDays, settlementAmounts } from "../lib/domain";

test("rental quotes include both dates and disclose a charged deposit separately", () => {
  assert.deepEqual(quote(1_000, 500, 10_000, "2028-02-28", "2028-03-01", 1_800, 800), {
    days: 3, rental: 3_000, cleaningFee: 500, serviceFee: 240,
    deposit: 10_000, ownerEarnings: 2_960, total: 13_740,
  });
  assert.equal(rentalDays("2028-10-28", "2028-10-30"), 3);
  assert.equal(rentalDays("2028-03-01", "2028-03-01"), 1);
  assert.equal(dateSchema.safeParse("2025-02-29").success, false);
  assert.throws(() => rentalDays("2028-03-02", "2028-03-01"));
  assert.throws(() => rentalDays("2028-01-01", "2028-04-01"));
  assert.throws(() => quote(1_000, 0, 0, "2028-01-01", "2028-01-01", 10_001, 0));
  assert.throws(() => quote(1_000.5, 0, 0, "2028-01-01", "2028-01-01", 0, 0));
});

test("claim awards cannot create money or exceed the charged deposit", () => {
  const booking = { deposit: 10_000, ownerEarnings: 2_960 };
  const settlement = settlementAmounts(booking, 2_500);
  assert.deepEqual(settlement, { refund: 7_500, transfer: 5_460 });
  assert.equal(settlement.refund + settlement.transfer, booking.deposit + booking.ownerEarnings);
  assert.deepEqual(settlementAmounts(booking, 0), { refund: 10_000, transfer: 2_960 });
  assert.throws(() => settlementAmounts(booking, 10_001));
  assert.throws(() => settlementAmounts(booking, -1));
  assert.throws(() => settlementAmounts(booking, 0.5));
});

const databaseUrl = process.env.TEST_DATABASE_URL;

test("persisted marketplace rules", { skip: !databaseUrl ? "Set TEST_DATABASE_URL to an isolated PostgreSQL test database." : false }, async (t) => {
  // No import of lib/db occurs until an explicit, checked test URL is selected.
  // Never fall back to DATABASE_URL: that variable can point at real customers.
  assert.notEqual(process.env.NODE_ENV, "production", "Integration tests cannot run in production mode.");
  const target = new URL(databaseUrl!);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol), "Tests require a direct PostgreSQL test connection.");
  const isLocalPGlite = ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) && target.port === "55432";
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  assert.ok(/(^|[_-])test($|[_-])/i.test(databaseName) || isLocalPGlite,
    "Refusing to touch a database without a test name or the dedicated local test port.");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
  process.env.CURRENCY = "gbp";
  process.env.COMMISSION_BPS = "1800";
  process.env.RENTER_FEE_BPS = "800";

  const { db } = await import("../lib/db");
  const market = await import("../lib/marketplace");
  const { HttpError } = await import("../lib/http");
  await db.$connect();
  const rejectsStatus = (operation: Promise<unknown>, status: number) =>
    assert.rejects(operation, (error: unknown) => error instanceof HttpError && error.status === status);
  const future = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  type Fixture = {
    prefix: string; owner: User; renter: User; stranger: User; admin: User;
    input: {
      title: string; description: string; brand: string; category: string; size: string;
      measurements: string; condition: string; location: string; dailyRate: number;
      cleaningFee: number; deposit: number; images: string[]; availableFrom: string; availableTo: string;
    };
  };
  async function withFixture(run: (fixture: Fixture) => Promise<void>) {
    const prefix = `it_${randomUUID().replaceAll("-", "")}`;
    const roles = ["owner", "renter", "stranger", "admin"] as const;
    const ids = roles.map((role) => `${prefix}_${role}`);
    try {
      await db.user.createMany({ data: roles.map((role, index) => ({
        id: ids[index], email: `${ids[index]}@example.invalid`, name: `${prefix} ${role}`,
        passwordHash: "TEST_ONLY_NOT_A_VALID_PASSWORD_HASH", role: role === "admin" ? "ADMIN" : "MEMBER",
        active: true, emailVerifiedAt: new Date(), payoutsEnabled: false,
      })) });
      const records = await db.user.findMany({ where: { id: { in: ids } } });
      const owner = records.find((record) => record.id === ids[0])!;
      const renter = records.find((record) => record.id === ids[1])!;
      const stranger = records.find((record) => record.id === ids[2])!;
      const admin = records.find((record) => record.id === ids[3])!;
      const photo = await db.upload.create({ data: {
        id: `${prefix}_photo`, ownerId: owner.id, key: `${prefix}.webp`, mimeType: "image/webp", bytes: 100, purpose: "LISTING",
      } });
      const input = {
        title: `${prefix} silk dress`, description: "Actual fixture garment description with accurate condition details.",
        brand: "Fixture designer", category: "Dresses", size: "UK 10", measurements: "Bust 90 cm",
        condition: "Very good, documented light wear", location: "Test locality", dailyRate: 1_000,
        cleaningFee: 500, deposit: 10_000, images: [`/api/media/${photo.id}`],
        availableFrom: future(1), availableTo: future(90),
      };
      await run({ prefix, owner, renter, stranger, admin, input });
    } finally {
      // Only this invocation's fixture IDs are removed. No whole-table reset.
      const listings = await db.listing.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
      const listingIds = listings.map((listing) => listing.id);
      await db.booking.deleteMany({ where: { listingId: { in: listingIds } } });
      await db.listing.deleteMany({ where: { id: { in: listingIds } } });
      await db.upload.deleteMany({ where: { ownerId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
    }
  }

  try {
    await t.test("listing publication requires moderation and never exposes private account fields", async () => {
      await withFixture(async ({ owner, renter, admin, input, prefix }) => {
        const listing = await market.createListing(owner, input);
        assert.equal(listing.status, "PENDING");
        assert.equal((await market.getListings(new URLSearchParams({ q: prefix }))).length, 0);
        await rejectsStatus(market.getListing(listing.id, renter), 404);
        assert.equal((await market.getListing(listing.id, owner)).listing.id, listing.id);
        await rejectsStatus(market.updateListing(listing.id, owner, { action: "approve" }), 403);
        await market.updateListing(listing.id, admin, { action: "approve", moderationNote: "Internal moderation note" });
        const publicDetail = await market.getListing(listing.id, null);
        const publicCatalogue = await market.getListings(new URLSearchParams({ q: prefix }));
        assert.equal(publicCatalogue.length, 1);
        assert.deepEqual(Object.keys(publicDetail.listing.owner).sort(), ["id", "name"]);
        assert.equal(publicDetail.listing.moderationNote, undefined);
        const serialized = JSON.stringify({ publicDetail, publicCatalogue });
        assert.equal(serialized.includes(owner.email), false);
        assert.equal(serialized.includes("passwordHash"), false);
        assert.equal(serialized.includes("stripeAccountId"), false);
        assert.equal(serialized.includes("Internal moderation note"), false);
      });
    });

    await t.test("listing photos must belong to the owner and have listing purpose", async () => {
      await withFixture(async ({ owner, renter, input }) => {
        await rejectsStatus(market.createListing(renter, input), 400);
        await rejectsStatus(market.createListing(owner, { ...input, images: ["/api/media/nonexistent_test_photo"] }), 400);
        await db.upload.update({ where: { id: input.images[0].split("/").pop()! }, data: { purpose: "EVIDENCE" } });
        await rejectsStatus(market.createListing(owner, input), 400);
        assert.equal(await db.listing.count({ where: { ownerId: { in: [owner.id, renter.id] } } }), 0);
      });
    });

    await t.test("unapproved, self-owned and suspended-owner listings cannot be booked", async () => {
      await withFixture(async ({ owner, renter, admin, input, prefix }) => {
        const listing = await market.createListing(owner, input);
        const request = { listingId: listing.id, startDate: future(10), endDate: future(12) };
        await rejectsStatus(market.requestBooking(renter, request), 409);
        await market.updateListing(listing.id, admin, { action: "approve" });
        await rejectsStatus(market.requestBooking(owner, request), 400);
        await db.user.update({ where: { id: owner.id }, data: { active: false } });
        await rejectsStatus(market.requestBooking(renter, request), 409);
        await rejectsStatus(market.getListing(listing.id, null), 404);
        assert.equal((await market.getListings(new URLSearchParams({ q: prefix }))).length, 0);
        assert.equal(await db.booking.count({ where: { listingId: listing.id } }), 0);
      });
    });

    await t.test("reservations enforce inclusive date conflicts, locked terms and participant privacy", async () => {
      await withFixture(async ({ owner, renter, stranger, admin, input, prefix }) => {
        const listing = await market.createListing(owner, input);
        await market.updateListing(listing.id, admin, { action: "approve" });
        const request = { listingId: listing.id, startDate: future(10), endDate: future(12) };
        const booking = await market.requestBooking(renter, request);
        assert.equal(booking.total, 13_740);
        await rejectsStatus(market.requestBooking(stranger, { ...request, startDate: future(12), endDate: future(13) }), 409);
        await rejectsStatus(market.updateListing(listing.id, owner, { ...input, action: "update", dailyRate: 99_000 }), 409);
        await rejectsStatus(market.getBooking(booking.id, stranger), 404);
        await rejectsStatus(market.bookingAction(booking.id, renter, { action: "approve" }), 403);
        await rejectsStatus(market.bookingAction(booking.id, stranger, { action: "message", text: "Unauthorized message" }), 404);
        const detail = await market.getBooking(booking.id, renter);
        assert.deepEqual(Object.keys(detail.renter).sort(), ["id", "name"]);
        assert.deepEqual(Object.keys(detail.listing.owner).sort(), ["id", "name"]);
        assert.equal(JSON.stringify(detail).includes("passwordHash"), false);
        assert.equal(JSON.stringify(detail).includes(owner.email), false);
        assert.equal((await market.getBooking(booking.id, admin)).id, booking.id);
        const unavailable = await market.getListings(new URLSearchParams({ q: prefix, dateFrom: future(11), dateTo: future(13) }));
        assert.equal(unavailable.length, 0);
        const nextBooking = await market.requestBooking(stranger, { ...request, startDate: future(13), endDate: future(14) });
        assert.equal(nextBooking.status, "REQUESTED");
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: booking.id } })).rental, 3_000);
      });
    });

    await t.test("expired unpaid requests release dates but paid reservations never expire into availability", async () => {
      await withFixture(async ({ owner, renter, stranger, admin, input }) => {
        const listing = await market.createListing(owner, input);
        await market.updateListing(listing.id, admin, { action: "approve" });
        const request = { listingId: listing.id, startDate: future(10), endDate: future(12) };
        const expired = await market.requestBooking(renter, request);
        await db.booking.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
        const paid = await market.requestBooking(stranger, request);
        assert.equal((await db.booking.findUniqueOrThrow({ where: { id: expired.id } })).status, "EXPIRED");
        await db.booking.update({ where: { id: paid.id }, data: { status: "CONFIRMED", paymentStatus: "PAID", expiresAt: new Date(Date.now() - 60_000) } });
        await rejectsStatus(market.requestBooking(renter, request), 409);
        const persisted = await db.booking.findUniqueOrThrow({ where: { id: paid.id } });
        assert.equal(persisted.status, "CONFIRMED");
        assert.equal(persisted.paymentStatus, "PAID");
      });
    });

    await t.test("suspended renter approval is refused and failed transitions do not modify the request", async () => {
      await withFixture(async ({ owner, renter, admin, input }) => {
        const listing = await market.createListing(owner, input);
        await market.updateListing(listing.id, admin, { action: "approve" });
        const booking = await market.requestBooking(renter, { listingId: listing.id, startDate: future(10), endDate: future(12) });
        await db.user.update({ where: { id: renter.id }, data: { active: false } });
        await rejectsStatus(market.bookingAction(booking.id, owner, { action: "approve" }), 409);
        await rejectsStatus(market.bookingAction(booking.id, owner, { action: "handover" }), 409);
        const persisted = await db.booking.findUniqueOrThrow({ where: { id: booking.id } });
        assert.equal(persisted.status, "REQUESTED");
        assert.equal(persisted.paymentStatus, "UNPAID");
      });
    });

    await t.test("two concurrent reservations cannot both acquire the same dates", {
      skip: isLocalPGlite ? "The local PGlite bridge is single-connection; PostgreSQL 16 CI exercises concurrent row locks." : false,
    }, async () => {
      await withFixture(async ({ owner, renter, stranger, admin, input }) => {
        const listing = await market.createListing(owner, input);
        await market.updateListing(listing.id, admin, { action: "approve" });
        const request = { listingId: listing.id, startDate: future(10), endDate: future(12) };
        const outcomes = await Promise.allSettled([market.requestBooking(renter, request), market.requestBooking(stranger, request)]);
        assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
        const rejected = outcomes.find((result) => result.status === "rejected");
        assert.ok(rejected?.status === "rejected" && rejected.reason instanceof HttpError && rejected.reason.status === 409);
        assert.equal(await db.booking.count({ where: { listingId: listing.id, status: "REQUESTED" } }), 1);
      });
    });
  } finally {
    await db.$disconnect();
  }
});
