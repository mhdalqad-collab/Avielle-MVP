"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  Booking,
  Button,
  date,
  errorMessage,
  Field,
  Loading,
  money,
  Notice,
  PhotoUpload,
  RequireAccount,
  Status,
  today,
  useAuth,
  useResource,
} from "./shared";

export function BookingPage({ id }: { id: string }) {
  return (
    <RequireAccount>
      <BookingContent id={id} />
    </RequireAccount>
  );
}
const stages: Record<string, string> = {
  REQUESTED: "Your request is with the lender. They have 48 hours to respond.",
  APPROVED:
    "The lender has accepted. Complete secure checkout before the payment deadline.",
  CHECKOUT_PENDING:
    "Checkout is open. Payment will be confirmed here after Stripe sends confirmation.",
  CONFIRMED:
    "Payment is confirmed. Arrange collection in your conversation and record the piece’s condition.",
  IN_USE:
    "Enjoy your piece. Before returning it, save your after-rental photos and confirm the return.",
  RETURNED:
    "The renter has recorded the return. The lender must photograph and inspect the piece before settlement.",
  CLAIM_OPEN:
    "A condition claim is being reviewed. Deposit settlement and lender earnings are paused.",
  SETTLING:
    "The deposit refund and lender transfer are being processed. Refresh or retry if needed.",
  SETTLEMENT_FAILED:
    "Settlement needs another attempt. Review the message below, then retry; completed financial steps will not be repeated.",
  LOSS_RESOLVED:
    "Operations has resolved the non-return claim. The agreed deposit deduction and lender earnings are ready for settlement. The missing piece is paused.",
  COMPLETED: "This rental is complete. Thank you for sharing your wardrobe.",
  CANCELLING:
    "Cancellation is processing. Any confirmed payment must be refunded before this booking closes.",
  CANCELLED:
    "This booking was cancelled. See the payment record below for any refund.",
  DECLINED: "The lender declined this request. No payment was collected.",
  EXPIRED:
    "This request expired. Make a new request if you still want to rent the piece.",
  PAYMENT_REVIEW:
    "This payment needs operations review. Do not hand over the piece until the payment record is resolved.",
};
function BookingContent({ id }: { id: string }) {
  const auth = useAuth();
  const params = useSearchParams();
  const resource = useResource<{ booking: Booking }>(
    `/api/bookings/${encodeURIComponent(id)}`,
  );
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [phase, setPhase] = useState<"BEFORE" | "AFTER">("BEFORE");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void resource.refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [resource.refresh]);
  async function act(
    action: string,
    body: Record<string, unknown> = {},
    text = "Saved.",
  ) {
    setBusy(action);
    setError("");
    setSuccess("");
    try {
      await api(`/api/bookings/${id}`, { action, ...body });
      setSuccess(text);
      await resource.refresh();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      await resource.refresh();
      return false;
    } finally {
      setBusy("");
    }
  }
  if (!resource.data && resource.loading)
    return (
      <div className="page">
        <Loading text="Opening your rental…" />
      </div>
    );
  if (!resource.data)
    return (
      <div className="page narrow">
        <Notice>{resource.error || "Rental not found."}</Notice>
        <Link className="button outline" href="/dashboard">
          Back to my wardrobe
        </Link>
      </div>
    );
  const b = resource.data.booking,
    user = auth.user!;
  const owner = user.id === b.listing.ownerId,
    renter = user.id === b.renterId,
    admin = user.role === "ADMIN";
  const evidence = b.evidence || [],
    reviews = b.reviews || [];
  const eligibleLoss = owner && b.status === "IN_USE" && b.endDate < today();
  const lossResolved =
    b.claim?.kind === "NOT_RETURNED" && b.claim.status === "RESOLVED";
  const ownerBefore = evidence.some(
    (e) => e.authorId === b.listing.ownerId && e.phase === "BEFORE",
  );
  const ownerAfter = evidence.some(
    (e) => e.authorId === b.listing.ownerId && e.phase === "AFTER",
  );
  const renterAfter = evidence.some(
    (e) => e.authorId === b.renterId && e.phase === "AFTER",
  );
  const allowedPhases = (["BEFORE", "AFTER"] as const).filter((p) =>
    p === "BEFORE"
      ? b.status === "CONFIRMED" || (renter && b.status === "IN_USE")
      : ["IN_USE", "RETURNED"].includes(b.status),
  );
  const availablePhases = allowedPhases.filter(
    (p) => !evidence.some((e) => e.authorId === user.id && e.phase === p),
  );
  const chosenPhase = availablePhases.includes(phase)
    ? phase
    : availablePhases[0];
  const expired =
    !!b.expiresAt &&
    new Date(b.expiresAt).getTime() <= Date.now() &&
    b.paymentStatus === "UNPAID";
  const cancelAllowed =
    [
      "REQUESTED",
      "APPROVED",
      "CHECKOUT_PENDING",
      "CONFIRMED",
      "CANCELLING",
      "EXPIRED",
    ].includes(b.status) && b.paymentStatus !== "DISPUTED";
  const name = (actor: string) =>
    actor === b.renterId
      ? b.renter.name
      : actor === b.listing.ownerId
        ? b.listing.owner.name
        : actor === user.id
          ? user.name
          : "Avielle operations";
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <div className="page booking-page">
      <Link href="/dashboard" className="back-link">
        <ArrowLeft size={16} />
        My wardrobe
      </Link>
      <div className="page-heading split">
        <div>
          <p className="eyebrow">YOUR RENTAL · {id.slice(-8).toUpperCase()}</p>
          <h1>
            A shared <em>chapter.</em>
          </h1>
        </div>
        <Button
          className="outline"
          busy={resource.loading}
          onClick={() => void resource.refresh()}
        >
          <RefreshCw size={16} />
          Refresh status
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {resource.error && <Notice>{resource.error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {params.get("checkout") === "return" && b.paymentStatus === "UNPAID" && (
        <Notice kind="info">
          You have returned from checkout. This page updates automatically; your
          booking is confirmed only after Stripe confirms payment.
        </Notice>
      )}
      <div className="booking-layout">
        <div className="stack">
          <section className="panel booking-summary">
            <Link
              href={`/items/${b.listing.id}`}
              className="booking-summary-photo"
            >
              {b.listing.images[0] && (
                <img src={b.listing.images[0]} alt={b.listing.title} />
              )}
            </Link>
            <div>
              <p className="eyebrow">{b.listing.brand}</p>
              <h2>
                <Link href={`/items/${b.listing.id}`}>{b.listing.title}</Link>
              </h2>
              <p>
                {date(b.startDate)} – {date(b.endDate)} · {b.days}{" "}
                {b.days === 1 ? "day" : "days"}
              </p>
              <p>{b.listing.location} · Local pickup</p>
              <p className="small">
                Lender:{" "}
                <Link
                  className="underline"
                  href={`/members/${b.listing.ownerId}`}
                >
                  {b.listing.owner.name}
                </Link>{" "}
                · Renter:{" "}
                <Link className="underline" href={`/members/${b.renterId}`}>
                  {b.renter.name}
                </Link>
              </p>
              <Status value={b.status} />
            </div>
          </section>
          <section className="panel">
            <p className="eyebrow">NEXT STEP</p>
            <h2>
              {b.status === "COMPLETED"
                ? "Wear. Share. Repeat."
                : "Keep your rental moving."}
            </h2>
            <p>
              {stages[b.status] ||
                "Follow the current booking and payment status here."}
            </p>
            {b.expiresAt &&
              ["REQUESTED", "APPROVED", "CHECKOUT_PENDING"].includes(
                b.status,
              ) && (
                <p className="deadline">
                  {expired
                    ? "The response or payment deadline has passed."
                    : `Deadline: ${time(b.expiresAt)}`}
                </p>
              )}
            {b.paymentStatus === "DISPUTED" && (
              <Notice>
                A payment dispute pauses handover and financial actions. Avielle
                operations must resolve it with Stripe.
              </Notice>
            )}
            {owner && b.status === "REQUESTED" && (
              <>
                <p className="small">
                  Your earnings if completed:{" "}
                  <strong>{money(b.ownerEarnings, b.currency)}</strong>, before
                  any awarded damage claim. Accept only if you can lend for the
                  full dates.
                </p>
                <div className="button-row">
                  <Button
                    disabled={!!busy || expired}
                    busy={busy === "approve"}
                    onClick={() =>
                      void act(
                        "approve",
                        {},
                        "Request accepted. The renter can now pay.",
                      )
                    }
                  >
                    Accept request <Check size={17} />
                  </Button>
                  <Button
                    className="outline"
                    disabled={!!busy || expired}
                    busy={busy === "decline"}
                    onClick={() => void act("decline", {}, "Request declined.")}
                  >
                    Decline request
                  </Button>
                </div>
              </>
            )}
            {renter && ["APPROVED", "CHECKOUT_PENDING"].includes(b.status) && (
              <div className="stack">
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    I accept the{" "}
                    <Link className="underline" href="/terms" target="_blank">
                      rental terms
                    </Link>
                    . The deposit is charged now and refunded after inspected
                    return, subject to any resolved claim. Pickup is local.
                  </span>
                </label>
                <Button
                  disabled={!!busy || !accepted || expired}
                  busy={busy === "checkout"}
                  onClick={async () => {
                    setBusy("checkout");
                    setError("");
                    try {
                      const result = await api<{ url: string }>(
                        "/api/payments/checkout",
                        { bookingId: id, acceptedTerms: true },
                      );
                      window.location.assign(result.url);
                    } catch (e) {
                      setError(errorMessage(e));
                      await resource.refresh();
                      setBusy("");
                    }
                  }}
                >
                  Continue to secure checkout <ArrowUpRight size={16} />
                </Button>
              </div>
            )}
            {owner && b.status === "CONFIRMED" && (
              <>
                <p className="small">
                  {!ownerBefore
                    ? "Save your before-handover condition report below first."
                    : "Your before-handover report is saved."}{" "}
                  Handover is available during the rental dates.
                </p>
                <Button
                  disabled={
                    !!busy ||
                    !ownerBefore ||
                    b.startDate > today() ||
                    b.endDate < today() ||
                    b.paymentStatus !== "PAID"
                  }
                  busy={busy === "handover"}
                  onClick={() =>
                    void act(
                      "handover",
                      {},
                      "Handover confirmed. The rental is now active.",
                    )
                  }
                >
                  Confirm handover
                </Button>
              </>
            )}
            {renter && b.status === "IN_USE" && (
              <>
                <p className="small">
                  Upload your after-rental report below, then confirm only after
                  returning the piece to the lender.
                </p>
                <Button
                  disabled={!!busy || !renterAfter}
                  busy={busy === "return"}
                  onClick={() =>
                    void act(
                      "return",
                      {},
                      "Return recorded. The lender can now inspect the piece.",
                    )
                  }
                >
                  I have returned the piece
                </Button>
              </>
            )}
            {(owner || admin) &&
              [
                "RETURNED",
                "LOSS_RESOLVED",
                "SETTLING",
                "SETTLEMENT_FAILED",
              ].includes(b.status) && (
                <>
                  <p className="small">
                    {lossResolved
                      ? "Operations resolved the non-return claim. Settlement releases the remaining deposit refund and lender earnings, including the awarded amount. No return inspection is required for a missing piece."
                      : !ownerAfter
                        ? "The lender must save an after-return inspection below before settlement."
                        : "An after-return inspection is saved. Accepting the return releases the eligible deposit refund and lender earnings through Stripe."}
                  </p>
                  <Button
                    disabled={
                      !!busy ||
                      (!ownerAfter && !lossResolved) ||
                      b.claim?.status === "OPEN" ||
                      b.paymentStatus === "DISPUTED"
                    }
                    busy={busy === "complete"}
                    onClick={() =>
                      void act(
                        "complete",
                        {},
                        "Settlement updated. The payment record shows the current refund and transfer state.",
                      )
                    }
                  >
                    {b.status === "RETURNED"
                      ? "Accept return & settle payment"
                      : b.status === "LOSS_RESOLVED"
                        ? "Settle resolved non-return claim"
                        : "Retry settlement"}
                  </Button>
                </>
              )}
            {cancelAllowed && (
              <div className="cancel-area">
                {cancelConfirm || b.status === "CANCELLING" ? (
                  <>
                    <p>
                      {b.status === "CANCELLING"
                        ? "Retry cancellation to finish any outstanding refund or checkout closure."
                        : "Cancel this rental? Before handover, any confirmed payment is refunded in full. This ends the reservation."}
                    </p>
                    <div className="button-row">
                      <Button
                        className="danger"
                        disabled={!!busy}
                        busy={busy === "cancel"}
                        onClick={async () => {
                          if (
                            await act(
                              "cancel",
                              {},
                              "Cancellation updated. Check the payment record for any refund.",
                            )
                          )
                            setCancelConfirm(false);
                        }}
                      >
                        {b.status === "CANCELLING"
                          ? "Retry cancellation"
                          : "Confirm cancellation"}
                      </Button>
                      {b.status !== "CANCELLING" && (
                        <Button
                          className="outline"
                          disabled={!!busy}
                          onClick={() => setCancelConfirm(false)}
                        >
                          Keep rental
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    className="text-link underline"
                    onClick={() => setCancelConfirm(true)}
                  >
                    Cancel rental
                  </button>
                )}
              </div>
            )}
          </section>
          <section className="panel" id="condition">
            <div className="section-heading">
              <div>
                <p className="eyebrow">A CLEAR RECORD</p>
                <h2>Condition photos.</h2>
              </div>
              <ShieldCheck size={23} />
            </div>
            <p className="small">
              Save an accurate report before handover and after return. Saved
              reports cannot be replaced; use the conversation for corrections.
              Reports are private to the rental participants and operations.
            </p>
            {evidence.length ? (
              <div className="evidence-list">
                {evidence.map((report) => (
                  <article className="condition-report" key={report.id}>
                    <div className="split">
                      <strong>
                        {report.phase === "BEFORE"
                          ? "Before handover"
                          : "After rental"}{" "}
                        · {name(report.authorId)}
                      </strong>
                      <small>{time(report.createdAt)}</small>
                    </div>
                    <p className="preserve">{report.notes}</p>
                    <div className="evidence-photos">
                      {report.photos.map((photo, i) => (
                        <a
                          key={photo}
                          href={photo}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={photo}
                            alt={`${name(report.authorId)} ${report.phase.toLowerCase()} condition photo ${i + 1}`}
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No condition reports have been saved yet.</p>
            )}
            {(owner || renter) &&
              availablePhases.length > 0 &&
              b.claim?.status !== "OPEN" && (
                <form
                  className="stack evidence-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (
                      await act(
                        "evidence",
                        { phase: chosenPhase, photos, notes },
                        "Condition report saved.",
                      )
                    ) {
                      setPhotos([]);
                      setNotes("");
                    }
                  }}
                >
                  <Field label="Report stage">
                    <select
                      value={chosenPhase}
                      onChange={(e) => {
                        setPhase(e.target.value as "BEFORE" | "AFTER");
                        setPhotos([]);
                      }}
                    >
                      {availablePhases.map((p) => (
                        <option key={p} value={p}>
                          {p === "BEFORE" ? "Before handover" : "After rental"}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <PhotoUpload
                    purpose="EVIDENCE"
                    bookingId={id}
                    value={photos}
                    onChange={setPhotos}
                  />
                  <Field label="Condition notes">
                    <textarea
                      minLength={3}
                      maxLength={3000}
                      required
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Describe the condition and any marks or wear visible in your photos."
                    />
                  </Field>
                  <Button
                    busy={busy === "evidence"}
                    disabled={!!busy || !photos.length}
                  >
                    Save condition report
                  </Button>
                </form>
              )}
          </section>
          {(b.claim ||
            (owner && b.status === "RETURNED" && b.deposit > 0) ||
            eligibleLoss) && (
            <section className="panel claim-panel">
              <p className="eyebrow">IF SOMETHING NEEDS ATTENTION</p>
              <h2>
                {b.claim?.kind === "NOT_RETURNED" || eligibleLoss
                  ? "Non-return claim."
                  : "Condition claim."}
              </h2>
              {b.claim ? (
                <>
                  <Status value={b.claim.status} />
                  <p className="preserve">{b.claim.description}</p>
                  <p>
                    Requested:{" "}
                    <strong>
                      {money(b.claim.requestedAmount, b.currency)}
                    </strong>
                  </p>
                  {b.claim.status === "RESOLVED" && (
                    <>
                      <p>
                        Awarded:{" "}
                        <strong>
                          {money(b.claim.awardedAmount, b.currency)}
                        </strong>
                      </p>
                      <p className="preserve">{b.claim.resolution}</p>
                    </>
                  )}
                  {admin && b.claim.status === "OPEN" && (
                    <form
                      className="stack"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const data = new FormData(e.currentTarget);
                        await act(
                          "resolve",
                          {
                            awardedAmount: Math.round(
                              Number(data.get("award")) * 100,
                            ),
                            resolution: String(data.get("resolution")),
                          },
                          "Claim resolved. The booking is ready for settlement.",
                        );
                      }}
                    >
                      <Field label={`Award (${b.currency.toUpperCase()})`}>
                        <input
                          name="award"
                          type="number"
                          required
                          min="0"
                          max={
                            Math.min(b.deposit, b.claim.requestedAmount) / 100
                          }
                          step="0.01"
                          defaultValue="0"
                        />
                      </Field>
                      <Field label="Resolution and reasons">
                        <textarea
                          name="resolution"
                          required
                          minLength={20}
                          maxLength={5000}
                          rows={4}
                        />
                      </Field>
                      <Button busy={busy === "resolve"} disabled={!!busy}>
                        Record claim resolution
                      </Button>
                    </form>
                  )}
                </>
              ) : (
                <details>
                  <summary>
                    {eligibleLoss
                      ? "Report an overdue, missing piece"
                      : "Report damage after inspection"}
                  </summary>
                  <p className="small">
                    {eligibleLoss
                      ? "The rental end date has passed. Use this only if the piece has not been returned. Your original handover report is required; do not create a return photo for a missing piece. Operations reviews the claim and any award is limited to the charged deposit."
                      : "A claim pauses settlement for operations review. Both lender condition reports are required. The requested amount cannot exceed the charged deposit."}
                  </p>
                  <form
                    className="stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      await act(
                        "claim",
                        {
                          kind: eligibleLoss ? "NOT_RETURNED" : "DAMAGE",
                          requestedAmount: Math.round(
                            Number(data.get("amount")) * 100,
                          ),
                          description: String(data.get("description")),
                        },
                        "Claim opened. Settlement is paused for review.",
                      );
                    }}
                  >
                    <Field
                      label={`Requested amount (${b.currency.toUpperCase()})`}
                    >
                      <input
                        name="amount"
                        required
                        type="number"
                        min={eligibleLoss ? "0" : "0.01"}
                        defaultValue={b.deposit === 0 ? 0 : undefined}
                        max={b.deposit / 100}
                        step="0.01"
                      />
                    </Field>
                    <Field
                      label={
                        eligibleLoss
                          ? "Describe the non-return and attempts to arrange return"
                          : "Describe the damage and evidence"
                      }
                    >
                      <textarea
                        name="description"
                        required
                        minLength={20}
                        maxLength={5000}
                        rows={4}
                      />
                    </Field>
                    <Button
                      busy={busy === "claim"}
                      disabled={
                        !!busy || !ownerBefore || (!eligibleLoss && !ownerAfter)
                      }
                    >
                      {eligibleLoss
                        ? "Submit non-return claim"
                        : "Submit condition claim"}
                    </Button>
                  </form>
                </details>
              )}
            </section>
          )}
          <section className="panel conversation" id="conversation">
            <div className="section-heading">
              <div>
                <p className="eyebrow">KEEP IN TOUCH</p>
                <h2>Your conversation.</h2>
              </div>
              <MessageCircle size={23} />
            </div>
            <p className="small muted">
              Agree pickup and return here. Messages update automatically every
              15 seconds.
            </p>
            <div className="messages" aria-live="polite">
              {b.messages?.length ? (
                b.messages.map((m) => (
                  <article
                    className={`message ${m.senderId === user.id ? "mine" : ""}`}
                    key={m.id}
                  >
                    <div>
                      <strong>{name(m.senderId)}</strong>
                      <time>{time(m.createdAt)}</time>
                    </div>
                    <p className="preserve">{m.text}</p>
                  </article>
                ))
              ) : (
                <p className="muted">
                  Start the conversation with a pickup question or a useful
                  detail.
                </p>
              )}
            </div>
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act("message", { text: message }, "Message sent."))
                  setMessage("");
              }}
            >
              <Field label="Message">
                <textarea
                  rows={3}
                  required
                  maxLength={3000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write to your rental partner…"
                />
              </Field>
              <Button
                busy={busy === "message"}
                disabled={!!busy || !message.trim()}
              >
                Send message
              </Button>
            </form>
          </section>
          {b.status === "COMPLETED" && (
            <section className="panel">
              <p className="eyebrow">FROM ONE WARDROBE TO ANOTHER</p>
              <h2>Share your experience.</h2>
              {reviews.map((r) => (
                <article className="condition-report" key={r.id}>
                  <strong>
                    {name(r.authorId)} · {r.rating}/5
                  </strong>
                  <p className="preserve">{r.comment}</p>
                </article>
              ))}
              {(owner || renter) &&
                !reviews.some((r) => r.authorId === user.id) && (
                  <form
                    className="stack"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const data = new FormData(e.currentTarget);
                      await act(
                        "review",
                        {
                          rating: Number(data.get("rating")),
                          comment: String(data.get("comment")),
                        },
                        "Your review is saved. Thank you.",
                      );
                    }}
                  >
                    <Field label="Rating">
                      <select name="rating" defaultValue="5">
                        {[5, 4, 3, 2, 1].map((n) => (
                          <option key={n} value={n}>
                            {n} of 5
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Your review">
                      <textarea
                        name="comment"
                        required
                        minLength={3}
                        maxLength={2000}
                        rows={3}
                      />
                    </Field>
                    <Button busy={busy === "review"} disabled={!!busy}>
                      Publish review
                    </Button>
                  </form>
                )}
            </section>
          )}
        </div>
        <aside className="stack booking-sidebar">
          <section className="panel">
            <p className="eyebrow">EVERY DETAIL, UP FRONT</p>
            <h2>Your rental total.</h2>
            <div className="costs">
              <div>
                <span>Rental · {b.days} days</span>
                <span>{money(b.rental, b.currency)}</span>
              </div>
              <div>
                <span>Cleaning</span>
                <span>{money(b.cleaningFee, b.currency)}</span>
              </div>
              <div>
                <span>Service fee</span>
                <span>{money(b.serviceFee, b.currency)}</span>
              </div>
              <div>
                <span>Refundable deposit</span>
                <span>{money(b.deposit, b.currency)}</span>
              </div>
              <div className="total">
                <strong>Total charged</strong>
                <strong>{money(b.total, b.currency)}</strong>
              </div>
            </div>
            <p className="small muted">
              The deposit is charged with checkout and refunded after inspected
              return, subject to any resolved claim.
            </p>
          </section>
          <section className="panel payment-record">
            <p className="eyebrow">PAYMENT RECORD</p>
            <dl>
              <div>
                <dt>Payment</dt>
                <dd>
                  <Status value={b.paymentStatus} />
                </dd>
              </div>
              <div>
                <dt>Refunded</dt>
                <dd>{money(b.refundedAmount, b.currency)}</dd>
              </div>
              <div>
                <dt>Lender earnings</dt>
                <dd>{money(b.ownerEarnings, b.currency)}</dd>
              </div>
              <div>
                <dt>Lender transfer</dt>
                <dd>
                  <Status value={b.payoutStatus} />
                </dd>
              </div>
            </dl>
            <p className="small muted">
              A transferred balance is sent to the lender’s Stripe account.
              Stripe controls the later bank payout timing. Provider or bank
              processing may delay refunds.
            </p>
          </section>
          <details className="panel history">
            <summary>Rental history</summary>
            <ol>
              {b.events?.map((e) => (
                <li key={e.id}>
                  <strong>{e.type.toLowerCase().replaceAll("_", " ")}</strong>
                  <small>{time(e.createdAt)}</small>
                  {e.detail && <p>{e.detail}</p>}
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </div>
    </div>
  );
}
