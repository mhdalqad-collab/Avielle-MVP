import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { type TestContext } from "node:test";
import Stripe from "stripe";
import type { User } from "@prisma/client";
import { FakeStripe, sdk } from "./helpers/fake-stripe";

// Doubles exist only in this test file. Production always defaults to the real
// Stripe SDK; its HTTP client is explicitly disabled here to catch accidental calls.
const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl) {
  assert.notEqual(process.env.NODE_ENV, "production");
  const target = new URL(databaseUrl);
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.match(decodeURIComponent(target.pathname.slice(1)), /(^|[_-])test($|[_-])/i, "Payment tests require an isolated test database.");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DIRECT_URL = databaseUrl;
}

test("webhooks reject invalid signatures, stale signatures, mode mismatches and unbounded bodies", async () => {
  const { verifyStripeEvent } = await import("../lib/payments");
  const client = sdk();
  const secret = "whsec_isolated_test_only";
  const body = JSON.stringify({ id: "evt_signature_only", object: "event", created: Math.floor(Date.now() / 1000), livemode: false, type: "test.event", data: { object: {} } });
  const signature = client.webhooks.generateTestHeaderString({ payload: body, secret });
  assert.equal(verifyStripeEvent(body, signature, client, secret, "sk_test_isolated").id, "evt_signature_only");
  assert.throws(() => verifyStripeEvent(body, signature, client, "wrong_secret", "sk_test_isolated"));
  assert.throws(() => verifyStripeEvent(body + " ", signature, client, secret, "sk_test_isolated"));
  assert.throws(() => verifyStripeEvent(body, client.webhooks.generateTestHeaderString({ payload: body, secret, timestamp: Math.floor(Date.now() / 1000) - 900 }), client, secret, "sk_test_isolated"));
  assert.throws(() => verifyStripeEvent(body, signature, client, secret, "sk_live_isolated"), /mode does not match/);
  assert.throws(() => verifyStripeEvent(body, signature, client, secret, "invalid"), /credentials/);
  const previousKey = process.env.STRIPE_SECRET_KEY, previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_isolated"; process.env.STRIPE_WEBHOOK_SECRET = secret;
  try {
    const { POST } = await import("../app/api/payments/webhook/route");
    assert.equal((await POST(new Request("http://localhost/api/payments/webhook", { method: "POST", body }))).status, 400);
    assert.equal((await POST(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { "stripe-signature": "invalid" }, body }))).status, 400);
    assert.equal((await POST(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: "x".repeat(1_000_001) }))).status, 413);
    process.env.STRIPE_SECRET_KEY = "sk_live_isolated";
    assert.equal((await POST(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }))).status, 400);
  } finally {
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previousSecret;
  }
});

test("payment and complete rental lifecycle with real persistent database and isolated provider double", { skip: !databaseUrl ? "Set TEST_DATABASE_URL to an isolated PostgreSQL test database." : false }, async t => {
  process.env.APP_URL = "http://localhost:3000";
  const { db } = await import("../lib/db");
  const market = await import("../lib/marketplace");
  const payment = await import("../lib/payments");
  const { HttpError } = await import("../lib/http");
  const date = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const rejectsStatus = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (error: unknown) => error instanceof HttpError && error.status === status);
  type Fixture = { prefix: string; owner: User; renter: User; admin: User; listingId: string; bookingId: string; provider: FakeStripe };
  async function fixture(context: TestContext, run: (fixture: Fixture) => Promise<void>, deposit = 10_000) {
    const prefix = `payments_${randomUUID().replaceAll("-", "")}`;
    const ids = ["owner", "renter", "admin"].map(role => `${prefix}_${role}`);
    try {
      await db.user.createMany({ data: ids.map((id, index) => ({ id, email: `${id}@example.invalid`, name: id, passwordHash: "TEST_ONLY_NO_LOGIN", emailVerifiedAt: new Date(), role: index === 2 ? "ADMIN" : "MEMBER", ...(index === 0 ? { stripeAccountId: `acct_${prefix}`, payoutsEnabled: true } : {}) })) });
      const users = await db.user.findMany({ where: { id: { in: ids } } });
      const [owner, renter, admin] = ids.map(id => users.find(user => user.id === id)!);
      const photo = await db.upload.create({ data: { ownerId: owner.id, key: `${prefix}.webp`, mimeType: "image/webp", bytes: 100, purpose: "LISTING" } });
      const listing = await market.createListing(owner, { title: "A real persisted test garment", description: "The isolated fixture used only by the payment lifecycle test suite.", brand: "Fixture", category: "Dresses", size: "M", condition: "Excellent", location: "Test city", dailyRate: 1000, cleaningFee: 500, deposit, images: [`/api/media/${photo.id}`], availableFrom: date(), availableTo: date(90) });
      await market.updateListing(listing.id, admin, { action: "approve" });
      const booking = await market.requestBooking(renter, { listingId: listing.id, startDate: date(), endDate: date(1) });
      const provider = new FakeStripe(prefix, owner.stripeAccountId!, context);
      await run({ prefix, owner, renter, admin, listingId: listing.id, bookingId: booking.id, provider });
    } finally {
      const listings = await db.listing.findMany({ where: { ownerId: { in: ids } }, select: { id: true } });
      await db.booking.deleteMany({ where: { listingId: { in: listings.map(listing => listing.id) } } });
      await db.listing.deleteMany({ where: { ownerId: { in: ids } } });
      await db.upload.deleteMany({ where: { ownerId: { in: ids } } });
      await db.user.deleteMany({ where: { id: { in: ids } } });
      await db.webhookEvent.deleteMany({ where: { id: { startsWith: `evt_${prefix}_` } } });
      process.env.APP_URL = "http://localhost:3000";
    }
  }
  async function confirm(f: Fixture) {
    await market.bookingAction(f.bookingId, f.owner, { action: "approve" });
    await payment.checkout(f.bookingId, f.renter, f.provider.client);
    const booking = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
    const event = f.provider.pay(booking.stripeSessionId!);
    await payment.handleStripeEvent(event, f.provider.client);
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).status, "CONFIRMED");
    return event;
  }
  async function evidence(f: Fixture, user: User, phase: "BEFORE" | "AFTER") {
    const photo = await db.upload.create({ data: { ownerId: user.id, key: `${f.prefix}_${user.id}_${phase}.webp`, mimeType: "image/webp", bytes: 100, purpose: "EVIDENCE", bookingId: f.bookingId } });
    await market.bookingAction(f.bookingId, user, { action: "evidence", phase, photos: [`/api/media/${photo.id}`], notes: `Recorded ${phase.toLowerCase()} condition with test evidence.` });
  }
  async function returnRental(f: Fixture) {
    await evidence(f, f.owner, "BEFORE"); await evidence(f, f.renter, "BEFORE");
    await market.bookingAction(f.bookingId, f.owner, { action: "handover" });
    await evidence(f, f.renter, "AFTER"); await market.bookingAction(f.bookingId, f.renter, { action: "return" });
    await evidence(f, f.owner, "AFTER");
  }
  async function settle(f: Fixture) { assert.equal((await market.bookingAction(f.bookingId, f.owner, { action: "complete" })).paymentWork, "settle"); await payment.settlePayment(f.bookingId, f.provider.client); }
  try {
    await t.test("lender/renter complete listing → approval → checkout → messages → evidence → return → refund/transfer → reviews", async context => fixture(context, async f => {
      await rejectsStatus(payment.checkout(f.bookingId, f.renter, f.provider.client), 409);
      await rejectsStatus(payment.checkout(f.bookingId, f.owner, f.provider.client), 404);
      const paidEvent = await confirm(f);
      await market.bookingAction(f.bookingId, f.renter, { action: "message", text: "Please confirm our pickup time." });
      await market.bookingAction(f.bookingId, f.owner, { action: "message", text: "Your pickup time is confirmed." });
      await rejectsStatus(market.bookingAction(f.bookingId, f.renter, { action: "return" }), 409);
      await rejectsStatus(market.bookingAction(f.bookingId, f.owner, { action: "handover" }), 400);
      await returnRental(f); await settle(f);
      let booking = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(booking.status, "COMPLETED"); assert.equal(booking.paymentStatus, "PARTIALLY_REFUNDED"); assert.equal(booking.refundedAmount, booking.deposit); assert.equal(booking.payoutStatus, "TRANSFERRED");
      assert.equal([...f.provider.transfers.values()][0].amount, booking.ownerEarnings);
      await market.bookingAction(f.bookingId, f.renter, { action: "review", rating: 5, comment: "Excellent condition and thoughtful lender." });
      await market.bookingAction(f.bookingId, f.owner, { action: "review", rating: 5, comment: "Returned the piece with great care." });
      await rejectsStatus(market.bookingAction(f.bookingId, f.renter, { action: "review", rating: 5, comment: "Duplicate review." }), 409);
      await payment.handleStripeEvent(paidEvent, f.provider.client);
      await payment.handleStripeEvent(f.provider.event("checkout.session.completed", paidEvent.data.object), f.provider.client);
      await payment.settlePayment(f.bookingId, f.provider.client);
      booking = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(booking.status, "COMPLETED"); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
      const detail = await market.getBooking(f.bookingId, f.renter);
      assert.equal(detail.messages.length, 2); assert.equal(detail.evidence.length, 4); assert.equal(detail.reviews.length, 2);
      assert.ok(await db.notification.count({ where: { bookingId: f.bookingId } }) > 0);
    }));

    await t.test("lost checkout response retries immutable parameters even after application URL changes", async context => fixture(context, async f => {
      await market.bookingAction(f.bookingId, f.owner, { action: "approve" });
      f.provider.loseCheckoutResponse = true;
      await assert.rejects(payment.checkout(f.bookingId, f.renter, f.provider.client), /lost Stripe checkout/);
      const intermediate = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(intermediate.status, "CHECKOUT_PENDING"); assert.ok(intermediate.stripeCheckoutParams); assert.equal(intermediate.stripeSessionId, null);
      process.env.APP_URL = "http://changed-local-origin.example";
      const opened = await payment.checkout(f.bookingId, { ...f.renter, email: "changed@example.invalid" }, f.provider.client);
      assert.match(opened.url, /^https:\/\/checkout\.stripe\.test\//);
      assert.deepEqual(f.provider.checkoutRequests[0], f.provider.checkoutRequests[1]); assert.equal(f.provider.sessions.size, 1);
    }));

    await t.test("unready lender does not shorten approval, near-expiry checkout is refused, checkout mismatch is rejected", async context => fixture(context, async f => {
      await market.bookingAction(f.bookingId, f.owner, { action: "approve" });
      const approved = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      f.provider.accountReady = false;
      await rejectsStatus(payment.checkout(f.bookingId, f.renter, f.provider.client), 409);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).expiresAt?.getTime(), approved.expiresAt?.getTime());
      f.provider.accountReady = true;
      await db.booking.update({ where: { id: f.bookingId }, data: { expiresAt: new Date(Date.now() + 10 * 60_000) } });
      await rejectsStatus(payment.checkout(f.bookingId, f.renter, f.provider.client), 409);
      assert.equal(f.provider.sessions.size, 0);
      await db.booking.update({ where: { id: f.bookingId }, data: { expiresAt: approved.expiresAt } });
      await payment.checkout(f.bookingId, f.renter, f.provider.client);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const event = f.provider.pay(row.stripeSessionId!);
      (event.data.object as Stripe.Checkout.Session).amount_total! += 1;
      await assert.rejects(payment.handleStripeEvent(event, f.provider.client), /does not match/);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).paymentStatus, "UNPAID");
    }));

    await t.test("cancellation recovers a lost checkout response and unpaid cancellation needs no configured provider", async context => fixture(context, async f => {
      await market.bookingAction(f.bookingId, f.owner, { action: "approve" }); f.provider.loseCheckoutResponse = true;
      await assert.rejects(payment.checkout(f.bookingId, f.renter, f.provider.client));
      await market.bookingAction(f.bookingId, f.renter, { action: "cancel" });
      await payment.cancelPayment(f.bookingId, f.provider.client);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).status, "CANCELLED");
      assert.equal([...f.provider.sessions.values()][0].status, "expired");
      const other = await market.requestBooking(f.renter, { listingId: f.listingId, startDate: date(2), endDate: date(3) });
      await market.bookingAction(other.id, f.renter, { action: "cancel" }); await payment.cancelPayment(other.id);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: other.id } })).status, "CANCELLED");
    }));

    await t.test("paid cancellation is refunded exactly once, including a lost refund response and expired idempotency cache", async context => fixture(context, async f => {
      await confirm(f); await market.bookingAction(f.bookingId, f.renter, { action: "cancel" });
      f.provider.loseRefundResponse = true; await assert.rejects(payment.cancelPayment(f.bookingId, f.provider.client), /lost refund/);
      f.provider.clearProviderIdempotencyCache(); await payment.cancelPayment(f.bookingId, f.provider.client); await payment.cancelPayment(f.bookingId, f.provider.client);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "CANCELLED"); assert.equal(row.refundedAmount, row.total); assert.equal(row.payoutStatus, "NOT_DUE"); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 0);
    }));

    await t.test("pending settlement refund resumes from refund.updated without duplicate refund or transfer", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f); f.provider.nextRefundStatus = "pending";
      await rejectsStatus(settle(f), 409);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "SETTLEMENT_FAILED"); assert.equal(row.paymentStatus, "REFUND_PENDING"); assert.equal(f.provider.transfers.size, 0);
      // Explicit retries remain safe while the provider still reports pending.
      await rejectsStatus(settle(f), 409); assert.equal(f.provider.refunds.size, 1);
      const event = f.provider.finishRefund(row.stripeRefundId!);
      await payment.handleStripeEvent(event, f.provider.client); await payment.handleStripeEvent(event, f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("pending cancellation stays reserved until the full refund succeeds and a replay is harmless", async context => fixture(context, async f => {
      await confirm(f); await market.bookingAction(f.bookingId, f.renter, { action: "cancel" });
      f.provider.nextRefundStatus = "pending"; await rejectsStatus(payment.cancelPayment(f.bookingId, f.provider.client), 409);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "CANCELLING"); assert.equal(row.paymentStatus, "REFUND_PENDING");
      await rejectsStatus(market.requestBooking(f.renter, { listingId: f.listingId, startDate: date(), endDate: date(1) }), 409);
      const event = f.provider.finishRefund(row.stripeRefundId!);
      await payment.handleStripeEvent(event, f.provider.client); await payment.handleStripeEvent(event, f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "CANCELLED"); assert.equal(row.refundedAmount, row.total); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 0);
    }));

    await t.test("a failed refund has an explicit durable retry and a lost transfer response is recovered beyond Stripe's cache", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f); f.provider.nextRefundStatus = "failed";
      await rejectsStatus(settle(f), 409); assert.equal(f.provider.refunds.size, 1);
      f.provider.loseTransferResponse = true; await assert.rejects(settle(f), /lost transfer/);
      assert.equal(f.provider.refunds.size, 2); assert.equal([...f.provider.refunds.values()].filter(refund => refund.status === "succeeded").length, 1);
      assert.equal(f.provider.transfers.size, 1);
      f.provider.clearProviderIdempotencyCache(); await settle(f);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(row.refundedAmount, row.deposit); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("damage claim prevents settlement until admin resolution and conserves the charged money", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      await market.bookingAction(f.bookingId, f.owner, { action: "claim", description: "A documented damage claim against the condition report.", requestedAmount: 2500 });
      await rejectsStatus(market.bookingAction(f.bookingId, f.owner, { action: "complete" }), 409);
      await rejectsStatus(market.bookingAction(f.bookingId, f.owner, { action: "resolve", resolution: "The damage was reviewed against the evidence.", awardedAmount: 2500 }), 403);
      await market.bookingAction(f.bookingId, f.admin, { action: "resolve", resolution: "The damage was reviewed against the evidence.", awardedAmount: 2500 });
      await settle(f);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.refundedAmount, 7500); assert.equal([...f.provider.transfers.values()][0].amount, row.ownerEarnings + 2500);
      assert.equal(row.refundedAmount + [...f.provider.transfers.values()][0].amount, row.deposit + row.ownerEarnings);
    }));

    await t.test("zero deposit settlement transfers earnings without inventing a refund", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f); await settle(f);
      assert.equal(f.provider.refunds.size, 0); assert.equal(f.provider.transfers.size, 1);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } }); assert.equal(row.paymentStatus, "PAID"); assert.equal(row.refundedAmount, 0);
    }, 0));

    await t.test("provider transfer failure keeps settlement recoverable without repeating the deposit refund", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f); f.provider.failTransfer = true;
      await assert.rejects(settle(f), /provider failure/);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "SETTLEMENT_FAILED"); assert.equal(row.refundedAmount, row.deposit); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 0);
      await settle(f); row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("unexpected provider refunds freeze the booking and never cause an additional automated refund", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const external = f.provider.externalRefund(row.stripePaymentIntentId!, 1000);
      // Even before the webhook arrives, the service detects the foreign refund.
      await rejectsStatus(settle(f), 409); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 0);
      await payment.handleStripeEvent(external, f.provider.client);
      const frozen = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(frozen.status, "PAYMENT_REVIEW"); assert.equal(frozen.payoutStatus, "FROZEN");
      await rejectsStatus(payment.settlePayment(f.bookingId, f.provider.client), 409);
    }));

    await t.test("delayed timely payment recovers a free hold; a replacement reservation forces a full refund", async context => fixture(context, async f => {
      await market.bookingAction(f.bookingId, f.owner, { action: "approve" }); await payment.checkout(f.bookingId, f.renter, f.provider.client);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } }); const paid = f.provider.pay(row.stripeSessionId!);
      paid.created = Math.floor(Date.now() / 1000) - 120;
      await db.booking.update({ where: { id: f.bookingId }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 60_000) } });
      await payment.handleStripeEvent(paid, f.provider.client);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).status, "CONFIRMED");
      await market.bookingAction(f.bookingId, f.renter, { action: "cancel" }); await payment.cancelPayment(f.bookingId, f.provider.client);
      const next = await market.requestBooking(f.renter, { listingId: f.listingId, startDate: date(), endDate: date(1) });
      await market.bookingAction(next.id, f.owner, { action: "approve" }); await payment.checkout(next.id, f.renter, f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: next.id } }); const late = f.provider.pay(row.stripeSessionId!); late.created = Math.floor(Date.now() / 1000) - 120;
      await db.booking.update({ where: { id: next.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
      const replacement = await market.requestBooking(f.renter, { listingId: f.listingId, startDate: date(), endDate: date(1) });
      await payment.handleStripeEvent(late, f.provider.client); await payment.handleStripeEvent(late, f.provider.client);
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: next.id } })).status, "CANCELLED");
      assert.equal((await db.booking.findUniqueOrThrow({ where: { id: replacement.id } })).status, "REQUESTED");
      assert.equal(f.provider.refunds.size, 2); assert.equal(f.provider.transfers.size, 0);
    }));

    await t.test("refund deliveries never erase disputes, and a dispute during transfer leaves a visible financial hold", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } }); const intentId = row.stripePaymentIntentId!;
      f.provider.afterTransfer = async () => {
        await payment.handleStripeEvent(f.provider.dispute(intentId), f.provider.client);
      };
      await rejectsStatus(settle(f), 409);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.paymentStatus, "DISPUTED"); assert.equal(row.payoutStatus, "REVIEW_REQUIRED"); assert.ok(row.stripeTransferId);
      await payment.handleStripeEvent(f.provider.event("charge.refunded", structuredClone(f.provider.charge(intentId))), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } }); assert.equal(row.paymentStatus, "DISPUTED"); assert.equal(row.payoutStatus, "REVIEW_REQUIRED");
      await rejectsStatus(payment.settlePayment(f.bookingId, f.provider.client), 409); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("won dispute stays frozen until funds return, then historical disputed=true no longer blocks settlement", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const intentId = row.stripePaymentIntentId!, opened = f.provider.dispute(intentId);
      const disputeId = (opened.data.object as Stripe.Dispute).id;
      await payment.handleStripeEvent(opened, f.provider.client);
      await rejectsStatus(settle(f), 409);
      await payment.handleStripeEvent(f.provider.closeDispute(disputeId, "won"), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.paymentStatus, "DISPUTED"); assert.equal(row.payoutStatus, "FROZEN");
      assert.equal(f.provider.refunds.size, 0); assert.equal(f.provider.transfers.size, 0);
      const reinstated = f.provider.closeDispute(disputeId, "won", true);
      await payment.handleStripeEvent(reinstated, f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.paymentStatus, "PAID"); assert.equal(row.status, "RETURNED"); assert.equal(row.payoutStatus, "PENDING");
      assert.equal(f.provider.charge(intentId).disputed, true, "The provider's historical flag remains true after a win");
      await settle(f);
      // Both an identical replay and an old-status event with a new event ID use current provider state.
      await payment.handleStripeEvent(opened, f.provider.client);
      await payment.handleStripeEvent(f.provider.event("charge.dispute.updated", opened.data.object), f.provider.client);
      await payment.handleStripeEvent(reinstated, f.provider.client);
      await payment.handleStripeEvent(f.provider.event("charge.refunded", structuredClone(f.provider.charge(intentId))), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(row.paymentStatus, "PARTIALLY_REFUNDED"); assert.equal(row.payoutStatus, "TRANSFERRED");
      assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("lost dispute cannot resume financial actions even if a funds-reinstated event is received", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const opened = f.provider.dispute(row.stripePaymentIntentId!), disputeId = (opened.data.object as Stripe.Dispute).id;
      await payment.handleStripeEvent(opened, f.provider.client);
      await payment.handleStripeEvent(f.provider.closeDispute(disputeId, "lost", true), f.provider.client);
      await rejectsStatus(settle(f), 409); await rejectsStatus(payment.settlePayment(f.bookingId, f.provider.client), 409);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.paymentStatus, "DISPUTED"); assert.equal(row.payoutStatus, "FROZEN");
      assert.equal(f.provider.refunds.size, 0); assert.equal(f.provider.transfers.size, 0);
    }));

    await t.test("won dispute does not erase a separate unexpected-refund hold", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const intentId = row.stripePaymentIntentId!, opened = f.provider.dispute(intentId), disputeId = (opened.data.object as Stripe.Dispute).id;
      await payment.handleStripeEvent(opened, f.provider.client);
      await payment.handleStripeEvent(f.provider.externalRefund(intentId, 1000), f.provider.client);
      await payment.handleStripeEvent(f.provider.closeDispute(disputeId, "won", true), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "PAYMENT_REVIEW"); assert.equal(row.paymentStatus, "PARTIALLY_REFUNDED"); assert.equal(row.payoutStatus, "FROZEN");
      await rejectsStatus(payment.settlePayment(f.bookingId, f.provider.client), 409);
      assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 0);
    }));

    await t.test("a dispute snapshot taken before a concurrent win cannot re-freeze the reconciled booking", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const opened = f.provider.dispute(row.stripePaymentIntentId!), disputeId = (opened.data.object as Stripe.Dispute).id;
      await payment.handleStripeEvent(opened, f.provider.client);
      f.provider.afterDisputesRead = async () => {
        await payment.handleStripeEvent(f.provider.closeDispute(disputeId, "won", true), f.provider.client);
      };
      await payment.handleStripeEvent(f.provider.event("charge.dispute.updated", opened.data.object), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.paymentStatus, "PAID"); assert.equal(row.payoutStatus, "PENDING");
      await settle(f); assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("restored dispute during a recorded transfer resumes settlement without transferring twice", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      let disputeId = "";
      f.provider.afterTransfer = async () => {
        const opened = f.provider.dispute(row.stripePaymentIntentId!); disputeId = (opened.data.object as Stripe.Dispute).id;
        await payment.handleStripeEvent(opened, f.provider.client);
      };
      await rejectsStatus(settle(f), 409);
      await payment.handleStripeEvent(f.provider.closeDispute(disputeId, "won", true), f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(row.paymentStatus, "PARTIALLY_REFUNDED"); assert.equal(row.payoutStatus, "TRANSFERRED");
      assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("replayed dispute resolution finishes a settlement whose transfer response was lost", async context => fixture(context, async f => {
      await confirm(f); await returnRental(f);
      await market.bookingAction(f.bookingId, f.owner, { action: "complete" });
      let row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      const opened = f.provider.dispute(row.stripePaymentIntentId!), disputeId = (opened.data.object as Stripe.Dispute).id;
      await payment.handleStripeEvent(opened, f.provider.client);
      const restored = f.provider.closeDispute(disputeId, "won", true);
      f.provider.loseTransferResponse = true;
      await assert.rejects(payment.handleStripeEvent(restored, f.provider.client), /lost transfer/);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "SETTLEMENT_FAILED"); assert.equal(row.paymentStatus, "PARTIALLY_REFUNDED");
      f.provider.clearProviderIdempotencyCache();
      await payment.handleStripeEvent(restored, f.provider.client);
      row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } });
      assert.equal(row.status, "COMPLETED"); assert.equal(row.payoutStatus, "TRANSFERRED");
      assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1);
    }));

    await t.test("simultaneous checkout/settlement retries share one session/refund/transfer", {
      skip: new URL(databaseUrl!).port === "55432" ? "Local PGlite bridge uses one connection; PostgreSQL CI covers concurrent requests." : false,
    }, async context => fixture(context, async f => {
      await market.bookingAction(f.bookingId, f.owner, { action: "approve" });
      await Promise.all([payment.checkout(f.bookingId, f.renter, f.provider.client), payment.checkout(f.bookingId, f.renter, f.provider.client)]);
      assert.equal(f.provider.sessions.size, 1);
      const row = await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } }); await payment.handleStripeEvent(f.provider.pay(row.stripeSessionId!), f.provider.client);
      await returnRental(f); await market.bookingAction(f.bookingId, f.owner, { action: "complete" });
      await Promise.all([payment.settlePayment(f.bookingId, f.provider.client), payment.settlePayment(f.bookingId, f.provider.client)]);
      assert.equal(f.provider.refunds.size, 1); assert.equal(f.provider.transfers.size, 1); assert.equal((await db.booking.findUniqueOrThrow({ where: { id: f.bookingId } })).status, "COMPLETED");
    }));
  } finally { await db.$disconnect(); }
});
