import assert from "node:assert/strict";
import { mock, type TestContext } from "node:test";
import Stripe from "stripe";

// Test-only Stripe double. Never imported by application code. Unexpected HTTP requests fail.
export const sdk = () => new Stripe("sk_test_isolated_no_network", {
  maxNetworkRetries: 0,
  httpClient: Stripe.createFetchHttpClient(async () => { throw new Error("Unexpected real provider network request in an isolated test"); }),
});
export class FakeStripe {
  readonly client = sdk();
  readonly sessions = new Map<string, Stripe.Checkout.Session>();
  readonly intents = new Map<string, Stripe.PaymentIntent>();
  readonly refunds = new Map<string, Stripe.Refund>();
  readonly transfers = new Map<string, Stripe.Transfer>();
  readonly disputes = new Map<string, Stripe.Dispute>();
  readonly checkoutRequests: Stripe.Checkout.SessionCreateParams[] = [];
  private readonly cache = new Map<string, { params: string; object: unknown }>();
  private sequence = 0;
  accountReady = true;
  loseCheckoutResponse = false;
  loseRefundResponse = false;
  loseTransferResponse = false;
  failTransfer = false;
  nextRefundStatus: NonNullable<Stripe.Refund["status"]> = "succeeded";
  afterTransfer?: () => Promise<void>;
  afterDisputesRead?: () => Promise<void>;
  constructor(readonly prefix: string, readonly accountId: string, t?: Pick<TestContext, "mock">) {
    const tracker = t?.mock ?? mock;
    tracker.method(this.client.accounts, "retrieve", async (id: string) => ({ id, payouts_enabled: this.accountReady, capabilities: { transfers: this.accountReady ? "active" : "inactive" } } as Stripe.Account));
    tracker.method(this.client.checkout.sessions, "create", async (params: Stripe.Checkout.SessionCreateParams, options: Stripe.RequestOptions) => {
      this.checkoutRequests.push(structuredClone(params));
      const result = this.once(options.idempotencyKey!, params, () => {
        const id = `cs_${this.prefix}_${++this.sequence}`;
        const amount = params.line_items!.reduce((sum, line) => sum + Number(line.price_data!.unit_amount) * Number(line.quantity), 0);
        const value = { id, object: "checkout.session", created: Math.floor(Date.now() / 1000), status: "open", url: `https://checkout.stripe.test/${id}`, payment_status: "unpaid", payment_intent: null, client_reference_id: params.client_reference_id, metadata: params.metadata, currency: params.line_items![0].price_data!.currency, amount_total: amount, expires_at: params.expires_at } as Stripe.Checkout.Session;
        this.sessions.set(id, value); return value;
      });
      if (this.loseCheckoutResponse) { this.loseCheckoutResponse = false; throw new Error("Simulated lost Stripe checkout response"); }
      return structuredClone(result);
    });
    tracker.method(this.client.checkout.sessions, "retrieve", async (id: string) => structuredClone(this.required(this.sessions, id)));
    tracker.method(this.client.checkout.sessions, "expire", async (id: string) => {
      const session = this.required(this.sessions, id);
      if (session.status !== "open") throw new Error("Session is no longer open");
      session.status = "expired"; session.url = null; return structuredClone(session);
    });
    tracker.method(this.client.checkout.sessions, "list", () => this.iterate(this.sessions));
    tracker.method(this.client.paymentIntents, "retrieve", async (id: string) => structuredClone(this.required(this.intents, id)));
    tracker.method(this.client.paymentIntents, "cancel", async (id: string) => { const intent = this.required(this.intents, id); intent.status = "canceled"; return structuredClone(intent); });
    tracker.method(this.client.disputes, "list", (params: Stripe.DisputeListParams) => this.disputeSnapshot(params));
    tracker.method(this.client.disputes, "retrieve", async (id: string) => structuredClone(this.required(this.disputes, id)));
    tracker.method(this.client.refunds, "retrieve", async (id: string) => structuredClone(this.required(this.refunds, id)));
    tracker.method(this.client.refunds, "list", (params: Stripe.RefundListParams) => this.iterate(this.refunds, refund => refund.payment_intent === params.payment_intent));
    tracker.method(this.client.refunds, "create", async (params: Stripe.RefundCreateParams, options: Stripe.RequestOptions) => {
      const result = this.once(options.idempotencyKey!, params, () => {
        const value = { id: `re_${this.prefix}_${++this.sequence}`, object: "refund", created: Math.floor(Date.now() / 1000), payment_intent: params.payment_intent, amount: params.amount, currency: "gbp", metadata: params.metadata, status: this.nextRefundStatus } as Stripe.Refund;
        this.nextRefundStatus = "succeeded"; this.refunds.set(value.id, value);
        if (value.status === "succeeded") this.applyRefund(value);
        return value;
      });
      if (this.loseRefundResponse) { this.loseRefundResponse = false; throw new Error("Simulated lost refund response"); }
      return structuredClone(result);
    });
    tracker.method(this.client.transfers, "retrieve", async (id: string) => structuredClone(this.required(this.transfers, id)));
    tracker.method(this.client.transfers, "list", (params: Stripe.TransferListParams) => this.iterate(this.transfers, transfer => transfer.transfer_group === params.transfer_group));
    tracker.method(this.client.transfers, "create", async (params: Stripe.TransferCreateParams, options: Stripe.RequestOptions) => {
      if (this.failTransfer) { this.failTransfer = false; throw new Error("Simulated transfer provider failure"); }
      const result = this.once(options.idempotencyKey!, params, () => {
        const value = { id: `tr_${this.prefix}_${++this.sequence}`, object: "transfer", amount: params.amount, amount_reversed: 0, currency: params.currency, destination: params.destination, source_transaction: params.source_transaction, transfer_group: params.transfer_group, metadata: params.metadata, reversed: false } as Stripe.Transfer;
        this.transfers.set(value.id, value); return value;
      });
      if (this.afterTransfer) { const action = this.afterTransfer; this.afterTransfer = undefined; await action(); }
      if (this.loseTransferResponse) { this.loseTransferResponse = false; throw new Error("Simulated lost transfer response"); }
      return structuredClone(result);
    });
  }
  private required<T>(map: Map<string, T>, id: string) { const value = map.get(id); assert.ok(value, `Unknown provider fixture ${id}`); return value; }
  private async *iterate<T>(map: Map<string, T>, filter: (value: T) => boolean = () => true) { for (const value of map.values()) if (filter(value)) yield structuredClone(value); }
  private async *disputeSnapshot(params: Stripe.DisputeListParams) {
    const snapshot = [...this.disputes.values()].filter(dispute => dispute.charge === params.charge).map(dispute => structuredClone(dispute));
    for (const dispute of snapshot) yield dispute;
    if (this.afterDisputesRead) { const action = this.afterDisputesRead; this.afterDisputesRead = undefined; await action(); }
  }
  private once<T>(key: string, params: unknown, create: () => T): T {
    assert.ok(key, "Every provider money mutation must carry an idempotency key");
    const previous = this.cache.get(key), encoded = JSON.stringify(params);
    if (previous) { assert.equal(encoded, previous.params, "Stripe rejects changed parameters for a reused idempotency key"); return previous.object as T; }
    const object = create(); this.cache.set(key, { params: encoded, object }); return object;
  }
  clearProviderIdempotencyCache() { this.cache.clear(); }
  event(type: Stripe.Event.Type, object: Stripe.Event.Data.Object, created = Math.floor(Date.now() / 1000)): Stripe.Event {
    return { id: `evt_${this.prefix}_${++this.sequence}`, object: "event", api_version: "2025-12-15.clover", created, livemode: false, pending_webhooks: 1, request: null, type, data: { object } } as Stripe.Event;
  }
  pay(sessionId: string) {
    const session = this.required(this.sessions, sessionId);
    const intentId = `pi_${this.prefix}_${++this.sequence}`;
    const charge = { id: `ch_${this.prefix}_${++this.sequence}`, object: "charge", amount: session.amount_total!, amount_refunded: 0, currency: session.currency!, disputed: false, refunded: false, payment_intent: intentId } as Stripe.Charge;
    const intent = { id: intentId, object: "payment_intent", amount: session.amount_total!, amount_received: session.amount_total!, currency: session.currency!, status: "succeeded", latest_charge: charge } as Stripe.PaymentIntent;
    this.intents.set(intentId, intent); session.status = "complete"; session.payment_status = "paid"; session.payment_intent = intentId; session.url = null;
    return this.event("checkout.session.completed", structuredClone(session));
  }
  charge(intentId: string) { const charge = this.required(this.intents, intentId).latest_charge; assert.ok(charge && typeof charge === "object"); return charge; }
  private applyRefund(refund: Stripe.Refund) {
    assert.equal(typeof refund.payment_intent, "string");
    const charge = this.charge(refund.payment_intent as string);
    assert.ok(charge.amount_refunded + refund.amount <= charge.amount, "Provider must reject excess refunds");
    charge.amount_refunded += refund.amount; charge.refunded = charge.amount_refunded === charge.amount;
  }
  finishRefund(id: string) { const refund = this.required(this.refunds, id); assert.notEqual(refund.status, "succeeded"); refund.status = "succeeded"; this.applyRefund(refund); return this.event("refund.updated", structuredClone(refund)); }
  externalRefund(intentId: string, amount: number) {
    const refund = { id: `re_external_${this.prefix}_${++this.sequence}`, object: "refund", created: Math.floor(Date.now() / 1000), payment_intent: intentId, amount, currency: "gbp", metadata: {}, status: "succeeded" } as Stripe.Refund;
    this.refunds.set(refund.id, refund); this.applyRefund(refund);
    return this.event("charge.refunded", structuredClone(this.charge(intentId)));
  }
  dispute(intentId: string) {
    const charge = this.charge(intentId); charge.disputed = true;
    const value = { id: `dp_${this.prefix}_${++this.sequence}`, object: "dispute", charge: charge.id, payment_intent: intentId, amount: charge.amount - charge.amount_refunded, currency: charge.currency, status: "needs_response", balance_transactions: [{ id: `txn_debit_${this.sequence}`, amount: -(charge.amount - charge.amount_refunded), currency: charge.currency }] } as Stripe.Dispute;
    this.disputes.set(value.id, value); return this.event("charge.dispute.created", structuredClone(value));
  }
  closeDispute(id: string, status: Stripe.Dispute["status"], restored = false) {
    const value = this.required(this.disputes, id); value.status = status;
    if (restored && !value.balance_transactions.some(movement => movement.amount > 0)) value.balance_transactions.push({ id: `txn_credit_${++this.sequence}`, amount: value.amount, currency: value.currency } as Stripe.BalanceTransaction);
    return this.event(restored ? "charge.dispute.funds_reinstated" : "charge.dispute.closed", structuredClone(value));
  }
}
