import Stripe from "stripe";
import { Prisma, type User } from "@prisma/client";
import { db } from "./db";
import { appUrl, paymentsReady } from "./config";
import { HttpError } from "./http";
import { settlementAmounts, today } from "./domain";
import { event, lockBooking, transaction } from "./marketplace";

export function stripeClient() {
  if (!paymentsReady()) throw new HttpError(503, "Online payments are not available yet. Your request can still be managed here.");
  if (!/^(sk|rk)_(test|live)_/.test(process.env.STRIPE_SECRET_KEY!)) throw new HttpError(503, "Payment credentials are not configured correctly.");
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, timeout: 15_000 });
}
// Kept separate from event processing so signature and account-mode checks always
// precede database or provider writes. Constructing/verifying an event makes no network request.
export function verifyStripeEvent(body: string, signature: string, stripe: Stripe, signingSecret: string, apiKey: string) {
  const verified = stripe.webhooks.constructEvent(body, signature, signingSecret);
  if (!/^(sk|rk)_(test|live)_/.test(apiKey)) throw new HttpError(503, "Payment credentials are not configured correctly.");
  if (verified.livemode !== /^(sk|rk)_live_/.test(apiKey)) throw new HttpError(400, "Webhook mode does not match the configured account.");
  return verified;
}
function accountReady(account: Stripe.Account) { return account.payouts_enabled && account.capabilities?.transfers === "active"; }
export async function syncConnect(user: User) {
  if (!user.stripeAccountId) return { payoutsEnabled: false, connected: false };
  const account = await stripeClient().accounts.retrieve(user.stripeAccountId);
  const payoutsEnabled = accountReady(account);
  await db.user.update({ where: { id: user.id }, data: { payoutsEnabled } });
  return { payoutsEnabled, connected: true };
}
export async function connect(user: User) {
  const stripe = stripeClient();
  let accountId = user.stripeAccountId;
  if (!accountId) {
    const country = (process.env.STRIPE_CONNECT_COUNTRY || "GB").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) throw new HttpError(503, "Lender onboarding is not configured.");
    const account = await stripe.accounts.create({ type: "express", country, email: user.email, capabilities: { transfers: { requested: true } }, metadata: { userId: user.id } }, { idempotencyKey: `avielle-connect-${user.id}` });
    accountId = account.id;
    await db.user.update({ where: { id: user.id }, data: { stripeAccountId: accountId, payoutsEnabled: accountReady(account) } });
  }
  const link = await stripe.accountLinks.create({ account: accountId, refresh_url: `${appUrl()}/dashboard?onboarding=refresh`, return_url: `${appUrl()}/dashboard?onboarding=return`, type: "account_onboarding" });
  return { url: link.url };
}
export async function checkout(id: string, user: User, stripe: Stripe = stripeClient()) {
  const validate = (value: Awaited<ReturnType<typeof lockBooking>>) => {
    if (value.renterId !== user.id) throw new HttpError(404, "Rental not found.");
    if (!["APPROVED", "CHECKOUT_PENDING"].includes(value.status) || value.paymentStatus !== "UNPAID" || !value.expiresAt || value.expiresAt <= new Date()) throw new HttpError(409, "This request is not approved for checkout, or has expired.");
    if (!value.renter.active || !value.listing.owner.active || value.listing.status !== "ACTIVE" || value.startDate < today()) throw new HttpError(409, "This rental is no longer available for payment.");
    if (!value.listing.owner.stripeAccountId) throw new HttpError(409, "The lender needs to finish payment onboarding before you can pay.");
  };
  const reference = await transaction(async (tx) => { const value = await lockBooking(tx, id); validate(value); return value; });
  const account = await stripe.accounts.retrieve(reference.listing.owner.stripeAccountId!);
  if (!accountReady(account)) throw new HttpError(409, "The lender's payment account is not yet ready. Ask them to complete onboarding.");
  // Store the ENTIRE request before crossing the provider boundary. In particular,
  // expires_at and redirect URLs must not change after a lost response or retry.
  const booking = await transaction(async (tx) => {
    const booking = await lockBooking(tx, id); validate(booking);
    if (booking.listing.owner.stripeAccountId !== account.id) throw new HttpError(409, "The lender's payment account changed. Please retry.");
    await tx.user.update({ where: { id: booking.listing.ownerId }, data: { payoutsEnabled: true } });
    if (booking.stripeCheckoutParams) return booking;
    if (booking.status !== "APPROVED" || booking.stripeSessionId) throw new HttpError(409, "This checkout requires payment reconciliation.");
    // Stripe requires at least 30 minutes. Do not extend the approved payment deadline.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresAt = Math.min(Math.floor(booking.expiresAt!.getTime() / 1000), nowSeconds + 31 * 60);
    if (expiresAt < nowSeconds + 31 * 60) throw new HttpError(409, "Fewer than 31 minutes remain to start checkout. Cancel this request and request the dates again.");
    const line = (name: string, amount: number): Stripe.Checkout.SessionCreateParams.LineItem => ({ quantity: 1, price_data: { currency: booking.currency, unit_amount: amount, product_data: { name } } });
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: "payment", payment_method_types: ["card"], client_reference_id: id,
      customer_email: user.email, success_url: `${appUrl()}/bookings/${id}?checkout=return`, cancel_url: `${appUrl()}/bookings/${id}`,
      expires_at: expiresAt,
      metadata: { bookingId: id, renterId: user.id },
      payment_intent_data: { metadata: { bookingId: id }, transfer_group: `avielle_${id}` },
      line_items: [line(`${booking.listing.title} · ${booking.days} day rental`, booking.rental), ...(booking.cleaningFee ? [line("Cleaning fee", booking.cleaningFee)] : []), ...(booking.serviceFee ? [line("Avielle service fee", booking.serviceFee)] : []), ...(booking.deposit ? [line("Refundable security deposit (charged now)", booking.deposit)] : [])],
      custom_text: { submit: { message: "Local pickup. Your refundable deposit is charged now and refunded after inspected return, less any agreed claim award. Lender earnings are transferred after the return." } },
    };
    const persisted = await tx.booking.update({ where: { id }, data: { status: "CHECKOUT_PENDING", expiresAt: new Date(expiresAt * 1000), stripeCheckoutParams: params as Prisma.InputJsonObject } });
    await event(tx, id, user.id, "CHECKOUT_STARTED", "Rental terms accepted. The total includes a charged refundable deposit; local pickup only; full refund before handover.");
    return { ...booking, ...persisted };
  });
  const session: Stripe.Checkout.Session = booking.stripeSessionId
    ? await stripe.checkout.sessions.retrieve(booking.stripeSessionId)
    : await stripe.checkout.sessions.create(booking.stripeCheckoutParams as Stripe.Checkout.SessionCreateParams, { idempotencyKey: `avielle-checkout-${id}` });
  const accepted = await transaction(async (tx) => {
    const latest = await lockBooking(tx, id);
    if (latest.status !== "CHECKOUT_PENDING" || latest.paymentStatus !== "UNPAID" || (latest.stripeSessionId && latest.stripeSessionId !== session.id)) return false;
    await tx.booking.update({ where: { id }, data: { stripeSessionId: session.id, expiresAt: new Date(session.expires_at * 1000) } });
    return true;
  });
  if (!accepted) {
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id);
    throw new HttpError(409, "This rental request changed while checkout was opening. Please refresh.");
  }
  if (session.status !== "open" || !session.url) throw new HttpError(409, "Checkout has ended. Payment confirmation appears after Stripe sends its confirmation.");
  return { url: session.url };
}
// The provider metadata lookup also protects retries after Stripe's 24-hour idempotency-key retention window.
async function refundOnce(stripe: Stripe, paymentIntent: string, amount: number, key: string, knownId?: string | null) {
  const refunds = new Map<string, Stripe.Refund>();
  if (knownId) { const known = await stripe.refunds.retrieve(knownId); refunds.set(known.id, known); }
  // Do not add a second refund after an operator/refund outside this workflow.
  // Search all pages: Stripe's request idempotency cache is not a permanent ledger.
  for await (const candidate of stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 })) refunds.set(candidate.id, candidate);
  const failed = (refund: Stripe.Refund) => refund.status === "failed" || refund.status === "canceled";
  const own: Stripe.Refund[] = [];
  for (const candidate of refunds.values()) {
    if (candidate.metadata?.operation !== key) {
      if (!failed(candidate)) throw new HttpError(409, "An additional refund requires operations reconciliation.");
      continue;
    }
    const intentId = typeof candidate.payment_intent === "string" ? candidate.payment_intent : candidate.payment_intent?.id;
    if (candidate.amount !== amount || intentId !== paymentIntent) throw new HttpError(409, "The refund requires payment reconciliation.");
    own.push(candidate);
  }
  const active = own.filter(candidate => !failed(candidate));
  if (active.length > 1) throw new HttpError(409, "Multiple refunds require operations reconciliation.");
  let refund = active[0];
  if (!refund) {
    const previous = own.sort((a, b) => b.created - a.created || Number(b.id === knownId) - Number(a.id === knownId) || b.id.localeCompare(a.id))[0];
    // A failed/canceled refund moved no funds. Its immutable ID gives the next
    // attempt a durable key, shared by simultaneous retries and recoverable after a crash.
    const attemptKey = previous ? `${key}-retry-${previous.id}` : key;
    refund = await stripe.refunds.create({ payment_intent: paymentIntent, amount, metadata: { operation: key } }, { idempotencyKey: attemptKey });
  }
  if (refund.amount !== amount || (typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id) !== paymentIntent) throw new HttpError(409, "The refund requires payment reconciliation.");
  return refund;
}
function hasFinancialHold(booking: { paymentStatus: string; payoutStatus: string }) {
  return booking.paymentStatus === "DISPUTED" || ["FROZEN", "REVIEW_REQUIRED"].includes(booking.payoutStatus);
}
async function currentDisputeState(stripe: Stripe, charge: Stripe.Charge, force = false) {
  if (!charge.disputed && !force) return { held: false, reason: "No dispute" };
  const disputes: Stripe.Dispute[] = [];
  for await (const dispute of stripe.disputes.list({ charge: charge.id, limit: 100 })) disputes.push(dispute);
  // charge.disputed records history, including won disputes. Use the current
  // dispute status AND gross balance movements, not webhook arrival order.
  if (!disputes.length) return { held: true, reason: "Dispute details are not yet available from Stripe" };
  for (const dispute of disputes) {
    if (!["won", "warning_closed", "prevented"].includes(dispute.status)) return { held: true, reason: `Stripe dispute remains ${dispute.status}` };
    const balances = new Map<string, number>();
    for (const movement of dispute.balance_transactions) balances.set(movement.currency, (balances.get(movement.currency) || 0) + movement.amount);
    // Fees remain an operator cost; principal is reconciled using amount, not net.
    if ([...balances.values()].some(amount => amount < 0) || (dispute.status === "won" && !dispute.balance_transactions.some(movement => movement.amount > 0))) return { held: true, reason: "The dispute is closed but its funds have not been reinstated" };
  }
  return { held: false, reason: "Stripe confirmed closed disputes and restored principal" };
}
async function assertPaidIntent(stripe: Stripe, intent: Stripe.PaymentIntent, booking: { total: number; currency: string }) {
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (intent.status !== "succeeded" || intent.amount_received !== booking.total || intent.currency !== booking.currency || !charge || charge.amount !== booking.total || charge.currency !== booking.currency) throw new HttpError(409, "Operations must reconcile this payment before further financial actions.");
  if ((await currentDisputeState(stripe, charge)).held) throw new HttpError(409, "Operations must reconcile this dispute before further financial actions.");
  return charge;
}
async function closeUnpaidCancellation(id: string) {
  await transaction(async (tx) => {
    const booking = await lockBooking(tx, id);
    if (booking.status === "CANCELLING" && booking.paymentStatus === "UNPAID") {
      await tx.booking.update({ where: { id }, data: { status: "CANCELLED", expiresAt: null, payoutStatus: "NOT_DUE" } });
      await event(tx, id, "system", "CANCELLED", "Checkout closed; no payment collected.");
    }
  });
}
export async function cancelPayment(id: string, provider?: Stripe) {
  const initial = await db.booking.findUniqueOrThrow({ where: { id } });
  if (initial.status === "CANCELLED") return;
  if (initial.status !== "CANCELLING") throw new HttpError(409, "Cancellation has not been requested.");
  if (hasFinancialHold(initial)) throw new HttpError(409, "Operations must resolve the payment hold before cancellation.");
  if (!initial.stripeSessionId && !initial.stripePaymentIntentId && !initial.stripeCheckoutParams && initial.paymentStatus === "UNPAID") {
    await closeUnpaidCancellation(id); return;
  }
  const stripe = provider ?? stripeClient();
  let intentId = initial.stripePaymentIntentId;
  let session: Stripe.Checkout.Session | undefined = initial.stripeSessionId ? await stripe.checkout.sessions.retrieve(initial.stripeSessionId) : undefined;
  if (!session && initial.stripeCheckoutParams) {
    const params = initial.stripeCheckoutParams as Stripe.Checkout.SessionCreateParams;
    // Recover a successful create whose response was lost, including after 24h.
    // Never create a fresh payable session while cancellation is in progress.
    for await (const candidate of stripe.checkout.sessions.list({ created: { gte: Number(params.expires_at) - 3600, lte: Number(params.expires_at) }, limit: 100 })) {
      if (candidate.client_reference_id === id && candidate.metadata?.bookingId === id && candidate.metadata?.renterId === initial.renterId) { session = candidate; break; }
    }
  }
  if (session) {
    await db.booking.update({ where: { id }, data: { stripeSessionId: session.id } });
    if (session.status === "open") {
      try { session = await stripe.checkout.sessions.expire(session.id); }
      catch { session = await stripe.checkout.sessions.retrieve(session.id); if (session.status === "open") throw new HttpError(503, "Checkout could not be closed yet. Retry cancellation shortly."); }
    }
    if (session.payment_intent) intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent.id;
  }
  if (intentId) {
    const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
    if (intent.status === "processing") throw new HttpError(409, "Stripe is still processing this payment. Retry cancellation shortly.");
    if (intent.status === "succeeded") {
      await assertPaidIntent(stripe, intent, initial);
      const latest = await db.booking.findUniqueOrThrow({ where: { id } });
      if (latest.status === "CANCELLED") return;
      if (latest.status !== "CANCELLING" || hasFinancialHold(latest)) throw new HttpError(409, "Cancellation is paused for operations review.");
      const refund = await refundOnce(stripe, intent.id, initial.total, `avielle-cancel-${id}`, initial.stripeRefundId);
      const completed = await transaction(async (tx) => {
        const booking = await lockBooking(tx, id);
        if (booking.status === "CANCELLED") return true;
        if (booking.status !== "CANCELLING") return false;
        const held = hasFinancialHold(booking);
        await tx.booking.update({ where: { id }, data: { stripePaymentIntentId: intent.id, stripeRefundId: refund.id,
          ...(refund.status === "succeeded" ? { refundedAmount: Math.max(booking.refundedAmount, refund.amount) } : {}),
          ...(!held ? { paymentStatus: refund.status === "succeeded" ? "REFUNDED" : "REFUND_PENDING", ...(refund.status === "succeeded" ? { status: "CANCELLED", payoutStatus: "NOT_DUE", expiresAt: null } : {}) } : {}) } });
        if (held) return false;
        await event(tx, id, "system", refund.status === "succeeded" ? "CANCELLED" : "REFUND_PENDING", refund.status === "succeeded" ? "Stripe confirmed the full refund." : "Stripe has not completed the refund yet; cancellation remains pending.");
        return refund.status === "succeeded";
      });
      if (!completed) throw new HttpError(409, "The refund is awaiting confirmation or operations review. Retry cancellation shortly.");
      return;
    }
    if (intent.status !== "canceled") await stripe.paymentIntents.cancel(intent.id, {}, { idempotencyKey: `avielle-cancel-intent-${id}` });
  }
  await closeUnpaidCancellation(id);
}
export async function settlePayment(id: string, stripe: Stripe = stripeClient()) {
  const booking = await db.booking.findUniqueOrThrow({ where: { id }, include: { listing: { include: { owner: true } }, claim: true } });
  if (booking.status === "COMPLETED") return;
  if (!["SETTLING", "SETTLEMENT_FAILED"].includes(booking.status) || !booking.stripePaymentIntentId || !booking.listing.owner.stripeAccountId || booking.claim?.status === "OPEN") throw new HttpError(409, "This rental is not ready for settlement.");
  if (!["PAID", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(booking.paymentStatus) || hasFinancialHold(booking)) throw new HttpError(409, "Payment reconciliation is required before settlement.");
  const amounts = settlementAmounts(booking, booking.claim?.awardedAmount || 0);
  try {
    const intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId, { expand: ["latest_charge"] });
    const charge = await assertPaidIntent(stripe, intent, booking);
    if (charge.amount_refunded > amounts.refund) throw new HttpError(409, "The payment requires operations review before settlement.");
    const account = await stripe.accounts.retrieve(booking.listing.owner.stripeAccountId);
    if (!accountReady(account)) throw new HttpError(409, "The lender must finish payment onboarding before settlement.");
    if (amounts.refund) {
      const refund = await refundOnce(stripe, intent.id, amounts.refund, `avielle-deposit-${id}-${booking.settlementVersion}`, booking.stripeRefundId);
      await transaction(async (tx) => {
        const latest = await lockBooking(tx, id);
        if (latest.status === "COMPLETED") return;
        await tx.booking.update({ where: { id }, data: { stripeRefundId: refund.id,
          ...(refund.status === "succeeded" ? { refundedAmount: Math.max(latest.refundedAmount, refund.amount) } : {}),
          ...(!hasFinancialHold(latest) && latest.refundedAmount <= refund.amount ? { paymentStatus: refund.status === "succeeded" || latest.refundedAmount === refund.amount ? "PARTIALLY_REFUNDED" : "REFUND_PENDING" } : {}) } });
      });
      if (refund.status !== "succeeded") throw new HttpError(409, "The deposit refund is awaiting Stripe confirmation. Retry settlement shortly.");
    }
    const beforeTransfer = await db.booking.findUniqueOrThrow({ where: { id } });
    if (beforeTransfer.status === "COMPLETED") return;
    if (!["SETTLING", "SETTLEMENT_FAILED"].includes(beforeTransfer.status) || hasFinancialHold(beforeTransfer)) throw new HttpError(409, "Settlement is paused for operations review.");
    // Re-check provider state after the refund; a dispute/refund may have arrived meanwhile.
    const currentCharge = await assertPaidIntent(stripe, await stripe.paymentIntents.retrieve(intent.id, { expand: ["latest_charge"] }), booking);
    if (currentCharge.amount_refunded !== amounts.refund) throw new HttpError(409, "The refunded amount requires reconciliation before transfer.");
    let transfer: Stripe.Transfer | undefined = booking.stripeTransferId ? await stripe.transfers.retrieve(booking.stripeTransferId) : undefined;
    const operation = `avielle-settle-${id}-${booking.settlementVersion}`;
    if (!transfer) {
      for await (const candidate of stripe.transfers.list({ transfer_group: `avielle_${id}`, limit: 100 })) {
        if (candidate.metadata.operation === operation) { transfer = candidate; break; }
      }
    }
    if (!transfer && amounts.transfer > 0) transfer = await stripe.transfers.create({ amount: amounts.transfer, currency: booking.currency, destination: booking.listing.owner.stripeAccountId, source_transaction: charge.id, transfer_group: `avielle_${id}`, metadata: { bookingId: id, operation } }, { idempotencyKey: operation });
    if (transfer && (transfer.amount !== amounts.transfer || transfer.currency !== booking.currency || (typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id) !== booking.listing.owner.stripeAccountId || transfer.source_transaction !== charge.id || transfer.reversed || transfer.amount_reversed > 0)) throw new HttpError(409, "The lender transfer requires operations review.");
    const completed = await transaction(async (tx) => {
      const latest = await lockBooking(tx, id);
      if (latest.status === "COMPLETED") return true;
      // Keep the transfer identifier even if a concurrent dispute requires review.
      // A network boundary cannot be atomic with Stripe; never hide money already moved.
      if (!["SETTLING", "SETTLEMENT_FAILED"].includes(latest.status) || hasFinancialHold(latest)) {
        await tx.booking.update({ where: { id }, data: { stripeTransferId: transfer?.id, payoutStatus: transfer ? "REVIEW_REQUIRED" : "FROZEN" } });
        return false;
      }
      await tx.booking.update({ where: { id }, data: { status: "COMPLETED", stripeTransferId: transfer?.id, payoutStatus: amounts.transfer > 0 ? "TRANSFERRED" : "NOT_DUE", expiresAt: null } });
      await event(tx, id, "system", "COMPLETED", "Stripe confirmed the deposit refund and transfer to the lender's connected balance. Bank payout timing is controlled by Stripe.");
      return true;
    });
    if (!completed) throw new HttpError(409, "A concurrent payment change requires operations review of the recorded transfer.");
  } catch (error) {
    await db.booking.updateMany({ where: { id, status: "SETTLING" }, data: { status: "SETTLEMENT_FAILED" } });
    throw error;
  }
}
async function receiveCheckout(stripe: Stripe, stripeEvent: Stripe.Event, session: Stripe.Checkout.Session) {
  const id = session.metadata?.bookingId;
  if (!id) return;
  const reference = await db.booking.findUnique({ where: { id }, select: { id: true } });
  if (!reference) return;
  const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  const intent = session.payment_status === "paid" && intentId ? await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] }) : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  const disputed = charge ? (await currentDisputeState(stripe, charge)).held : false;
  let needsRefund = false;
  await transaction(async (tx) => {
    const booking = await lockBooking(tx, id);
    if (await tx.webhookEvent.findUnique({ where: { id: stripeEvent.id } })) { needsRefund = booking.status === "CANCELLING"; return; }
    if (stripeEvent.type === "checkout.session.expired") {
      if (booking.stripeSessionId === session.id && booking.status === "CHECKOUT_PENDING" && booking.paymentStatus === "UNPAID") { await tx.booking.update({ where: { id }, data: { status: "EXPIRED" } }); await event(tx, id, "stripe", "EXPIRED", "Stripe checkout expired without payment."); }
    } else if (session.payment_status === "paid") {
      if (!intentId || session.amount_total !== booking.total || session.currency !== booking.currency || session.client_reference_id !== id || session.metadata?.renterId !== booking.renterId) throw new Error("Stripe checkout does not match the authoritative booking.");
      if (!intent || intent.status !== "succeeded" || intent.amount_received !== booking.total || intent.currency !== booking.currency || !charge || charge.amount !== booking.total || charge.currency !== booking.currency) throw new Error("Stripe payment does not match the authoritative booking.");
      if (booking.stripePaymentIntentId && booking.stripePaymentIntentId !== intentId) throw new Error("Unexpected second payment for the booking; operations review required.");
      // A duplicate delivery must never turn a returned or refunded rental back into CONFIRMED.
      if (booking.paymentStatus === "UNPAID" || booking.status === "CANCELLING") {
        if (hasFinancialHold(booking) || disputed || (charge.amount_refunded > 0 && booking.status !== "CANCELLING")) {
          await tx.booking.update({ where: { id }, data: { stripeSessionId: session.id, stripePaymentIntentId: intentId,
            refundedAmount: Math.max(booking.refundedAmount, charge.amount_refunded),
            paymentStatus: booking.paymentStatus === "DISPUTED" || disputed ? "DISPUTED" : charge.refunded ? "REFUNDED" : "PARTIALLY_REFUNDED",
            status: "PAYMENT_REVIEW", payoutStatus: "FROZEN", expiresAt: null } });
          await event(tx, id, "stripe", "PAYMENT_REVIEW", "Payment changed before checkout confirmation; operations reconciliation is required.");
          await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
          return;
        }
        // Use the signed occurrence time, not delivery time. A delayed webhook may
        // confirm an expired local hold only when payment was timely and no new booking overlaps.
        const valid = ["CHECKOUT_PENDING", "EXPIRED"].includes(booking.status) && (!booking.stripeSessionId || booking.stripeSessionId === session.id) && !!booking.expiresAt && stripeEvent.created * 1000 <= booking.expiresAt.getTime() && booking.startDate >= today() && booking.listing.status === "ACTIVE" && booking.listing.owner.active && booking.renter.active;
        const conflict = valid ? await tx.booking.findFirst({ where: { listingId: booking.listingId, id: { not: id }, status: { notIn: ["CANCELLED", "DECLINED", "EXPIRED", "COMPLETED"] }, startDate: { lte: booking.endDate }, endDate: { gte: booking.startDate }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }, { paymentStatus: { not: "UNPAID" } }] }, select: { id: true } }) : null;
        needsRefund = !valid || !!conflict;
        await tx.booking.update({ where: { id }, data: { stripeSessionId: session.id, stripePaymentIntentId: intentId, paymentStatus: charge.amount_refunded ? charge.refunded ? "REFUNDED" : "PARTIALLY_REFUNDED" : "PAID", status: needsRefund ? "CANCELLING" : "CONFIRMED", expiresAt: null } });
        await event(tx, id, "stripe", needsRefund ? "LATE_PAYMENT_REFUND_REQUIRED" : "PAYMENT_CONFIRMED", needsRefund ? "Payment arrived after the reservation ceased to be valid; refund requested." : "Stripe confirmed payment including the refundable deposit.");
      }
    }
    await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
  });
  if (needsRefund) await cancelPayment(id, stripe);
}
async function receiveDispute(stripe: Stripe, stripeEvent: Stripe.Event, attempt = 0): Promise<void> {
  const incoming = stripeEvent.data.object as Stripe.Dispute;
  const intentId = typeof incoming.payment_intent === "string" ? incoming.payment_intent : incoming.payment_intent?.id;
  if (!intentId) return;
  const reference = await db.booking.findUnique({ where: { stripePaymentIntentId: intentId }, select: { id: true, stripeTransferId: true, updatedAt: true, status: true, paymentStatus: true, payoutStatus: true, refundedAmount: true } });
  if (!reference) return;
  const intent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
  const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (!charge) throw new Error("Disputed charge is unavailable.");
  const state = await currentDisputeState(stripe, charge, true);
  const refunds: Stripe.Refund[] = [];
  if (!state.held) for await (const refund of stripe.refunds.list({ payment_intent: intentId, limit: 100 })) refunds.push(refund);
  const transfer = !state.held && reference.stripeTransferId ? await stripe.transfers.retrieve(reference.stripeTransferId) : null;
  const recovery = await transaction(async (tx): Promise<"cancel" | "settle" | "retry" | undefined> => {
    const booking = await lockBooking(tx, reference.id);
    // Another webhook may have resolved a dispute while the provider read was in
    // flight. Refresh the snapshot instead of re-freezing it from stale data.
    if (booking.updatedAt.getTime() !== reference.updatedAt.getTime() || booking.status !== reference.status || booking.paymentStatus !== reference.paymentStatus || booking.payoutStatus !== reference.payoutStatus || booking.refundedAmount !== reference.refundedAmount || booking.stripeTransferId !== reference.stripeTransferId) return "retry";
    if (intent.amount_received !== booking.total || intent.currency !== booking.currency || charge.amount !== booking.total || charge.currency !== booking.currency) throw new Error("Dispute payment does not match the booking.");
    const seen = await tx.webhookEvent.findUnique({ where: { id: stripeEvent.id } });
    if (state.held) {
      await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus: "DISPUTED", payoutStatus: booking.stripeTransferId ? "REVIEW_REQUIRED" : "FROZEN" } });
      if (!seen) await event(tx, booking.id, "stripe", "PAYMENT_DISPUTED", `${state.reason}. Operations must review the dispute in Stripe; financial actions remain paused.`);
    } else if (booking.paymentStatus === "DISPUTED") {
      const cancelling = ["CANCELLING", "CANCELLED"].includes(booking.status);
      const settling = ["SETTLING", "SETTLEMENT_FAILED", "COMPLETED"].includes(booking.status);
      const amounts = settlementAmounts(booking, booking.claim?.awardedAmount || 0);
      const expected = cancelling ? booking.total : settling ? amounts.refund : 0;
      const operation = cancelling ? `avielle-cancel-${booking.id}` : `avielle-deposit-${booking.id}-${booking.settlementVersion}`;
      const activeRefunds = refunds.filter(refund => !["failed", "canceled"].includes(refund.status || ""));
      const unknownRefund = activeRefunds.some(refund => refund.metadata?.operation !== operation || refund.amount !== expected) || activeRefunds.length > 1;
      const invalidTransfer = booking.stripeTransferId && (!transfer || transfer.id !== booking.stripeTransferId || transfer.reversed || transfer.amount_reversed > 0 || transfer.amount !== amounts.transfer || transfer.currency !== booking.currency || (typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id) !== booking.listing.owner.stripeAccountId || transfer.source_transaction !== charge.id);
      const review = booking.status === "PAYMENT_REVIEW" || unknownRefund || invalidTransfer || charge.amount_refunded > expected;
      const amount = Math.max(booking.refundedAmount, charge.amount_refunded);
      const paymentStatus = amount >= booking.total ? "REFUNDED" : amount > 0 ? "PARTIALLY_REFUNDED" : activeRefunds.length ? "REFUND_PENDING" : "PAID";
      await tx.booking.update({ where: { id: booking.id }, data: { paymentStatus, refundedAmount: amount,
        payoutStatus: review ? booking.stripeTransferId ? "REVIEW_REQUIRED" : "FROZEN" : booking.status === "COMPLETED" && booking.stripeTransferId ? "TRANSFERRED" : booking.status === "CANCELLED" ? "NOT_DUE" : "PENDING",
        ...(review ? { status: "PAYMENT_REVIEW" } : {}) } });
      if (!seen) await event(tx, booking.id, "stripe", review ? "DISPUTE_CLOSED_REVIEW_REQUIRED" : "DISPUTE_RESOLVED", review ? "Stripe closed the dispute and reinstated principal, but other financial differences still require operations review." : "Stripe confirmed the dispute is closed and principal restored. Normal rental actions can resume.");
      if (!seen) await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
      if (!review && booking.status === "CANCELLING") return "cancel";
      if (!review && ["SETTLING", "SETTLEMENT_FAILED"].includes(booking.status)) return "settle";
      return;
    }
    if (!seen) await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
    // A preceding delivery can commit reconciliation and then lose a provider
    // response. Replays must finish that recorded operation, not merely acknowledge it.
    if (!state.held && !hasFinancialHold(booking)) {
      if (booking.status === "CANCELLING") return "cancel";
      if (["SETTLING", "SETTLEMENT_FAILED"].includes(booking.status)) return "settle";
    }
  });
  if (recovery === "retry") {
    if (attempt >= 3) throw new HttpError(503, "The payment changed during dispute reconciliation. Retry this event.");
    await receiveDispute(stripe, stripeEvent, attempt + 1); return;
  }
  if (recovery === "cancel") await cancelPayment(reference.id, stripe);
  if (recovery === "settle") await settlePayment(reference.id, stripe);
}
export async function handleStripeEvent(stripeEvent: Stripe.Event, stripe: Stripe = stripeClient()) {
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"].includes(stripeEvent.type)) {
    await receiveCheckout(stripe, stripeEvent, stripeEvent.data.object as Stripe.Checkout.Session); return;
  }
  if (["charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed", "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated"].includes(stripeEvent.type)) {
    await receiveDispute(stripe, stripeEvent); return;
  }
  if (stripeEvent.type === "account.updated") {
    const account = stripeEvent.data.object as Stripe.Account;
    // Fetch the latest account: delivery order is not guaranteed.
    const current = await stripe.accounts.retrieve(account.id);
    await transaction(async (tx) => {
      if (await tx.webhookEvent.findUnique({ where: { id: stripeEvent.id } })) return;
      await tx.user.updateMany({ where: { stripeAccountId: account.id }, data: { payoutsEnabled: accountReady(current) } });
      await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
    }); return;
  }
  if (["charge.refunded", "refund.created", "refund.updated", "refund.failed"].includes(stripeEvent.type)) {
    const object = stripeEvent.data.object as Stripe.Charge | Stripe.Refund;
    const intent = object.payment_intent;
    const intentId = typeof intent === "string" ? intent : intent?.id;
    if (!intentId) return;
    const reference = await db.booking.findUnique({ where: { stripePaymentIntentId: intentId }, select: { id: true } });
    if (!reference) return;
    const currentIntent = await stripe.paymentIntents.retrieve(intentId, { expand: ["latest_charge"] });
    const currentCharge = currentIntent && typeof currentIntent.latest_charge === "object" ? currentIntent.latest_charge : null;
    const providerDisputed = currentCharge ? (await currentDisputeState(stripe, currentCharge)).held : false;
    const providerRefunds: Stripe.Refund[] = [];
    if (currentCharge) for await (const refund of stripe.refunds.list({ payment_intent: intentId, limit: 100 })) providerRefunds.push(refund);
    const recovery = await transaction(async (tx): Promise<"cancel" | "settle" | undefined> => {
      const booking = await lockBooking(tx, reference.id);
      const seen = await tx.webhookEvent.findUnique({ where: { id: stripeEvent.id } });
      {
        if (!currentCharge || !currentIntent || currentIntent.amount_received !== booking.total || currentIntent.currency !== booking.currency) throw new Error("Stripe refund does not match the booking payment.");
        const cancelling = ["CANCELLING", "CANCELLED"].includes(booking.status);
        const settling = ["SETTLING", "SETTLEMENT_FAILED", "COMPLETED"].includes(booking.status);
        const expected = cancelling ? booking.total : settlementAmounts(booking, booking.claim?.awardedAmount || 0).refund;
        const operation = cancelling ? `avielle-cancel-${booking.id}` : `avielle-deposit-${booking.id}-${booking.settlementVersion}`;
        const activeRefunds = providerRefunds.filter(refund => !["failed", "canceled"].includes(refund.status || ""));
        const unknownRefund = activeRefunds.some(refund => refund.metadata?.operation !== operation || refund.amount !== expected) || activeRefunds.length > 1;
        const disputed = booking.paymentStatus === "DISPUTED" || providerDisputed;
        const held = hasFinancialHold(booking) || disputed;
        const review = !cancelling && !settling || unknownRefund || currentCharge.amount_refunded > expected;
        const amount = Math.max(booking.refundedAmount, currentCharge.amount_refunded);
        const pending = providerRefunds.some(refund => refund.metadata?.operation === operation && refund.status !== "succeeded");
        await tx.booking.update({ where: { id: booking.id }, data: { refundedAmount: amount,
          paymentStatus: disputed ? "DISPUTED" : held ? booking.paymentStatus : amount >= booking.total ? "REFUNDED" : amount > 0 ? "PARTIALLY_REFUNDED" : pending ? "REFUND_PENDING" : booking.paymentStatus,
          ...(disputed || review ? { payoutStatus: booking.stripeTransferId ? "REVIEW_REQUIRED" : "FROZEN", ...(!disputed ? { status: "PAYMENT_REVIEW" } : {}) } : {}) } });
        if (!seen) await event(tx, booking.id, "stripe", "REFUND_UPDATED", review ? "An unexpected refund requires operations review." : "Stripe reported the current refunded amount.");
        if (!seen) await tx.webhookEvent.create({ data: { id: stripeEvent.id, type: stripeEvent.type } });
        // Recover after a pending refund or a process crash. Failed refunds remain
        // visible for an explicit retry; do not create unlimited automatic attempts.
        if (!held && !review && currentCharge.amount_refunded === expected && activeRefunds.every(refund => refund.status === "succeeded")) {
          if (booking.status === "CANCELLING") return "cancel";
          if (["SETTLING", "SETTLEMENT_FAILED"].includes(booking.status)) return "settle";
        }
        return;
      }
    });
    if (recovery === "cancel") await cancelPayment(reference.id, stripe);
    if (recovery === "settle") await settlePayment(reference.id, stripe);
    return;
  }
  // Record unsupported signed event types without acting on their contents.
  await db.webhookEvent.upsert({ where: { id: stripeEvent.id }, create: { id: stripeEvent.id, type: stripeEvent.type }, update: {} });
}
