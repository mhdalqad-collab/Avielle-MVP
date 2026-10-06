"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Notifications } from "./notifications";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  api,
  Booking,
  Button,
  date,
  Empty,
  errorMessage,
  Field,
  Listing,
  Loading,
  money,
  Notice,
  RequireAccount,
  Status,
  useAuth,
  User,
  useResource,
} from "./shared";

type Dashboard = {
  user: User;
  listings: Listing[];
  bookings: Booking[];
  currency?: string;
  commissionBps?: number;
  renterFeeBps?: number;
  paymentsReady?: boolean;
  admin?: { listings: Listing[]; bookings: Booking[]; users: User[] };
};
export function DashboardPage() {
  return (
    <RequireAccount>
      <DashboardContent />
    </RequireAccount>
  );
}
function DashboardContent() {
  const auth = useAuth();
  const params = useSearchParams();
  const resource = useResource<Dashboard>("/api/dashboard");
  const [tab, setTab] = useState("rentals");
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void resource.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [resource.refresh]);
  async function act(
    key: string,
    task: () => Promise<unknown>,
    success?: string,
  ) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await task();
      if (success) setMessage(success);
      await resource.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  if (resource.loading && !resource.data)
    return (
      <div className="page">
        <Loading text="Opening your wardrobe…" />
      </div>
    );
  if (!resource.data)
    return (
      <div className="page narrow">
        <Notice>{resource.error || "We couldn’t open your wardrobe."}</Notice>
        <Button onClick={() => void resource.refresh()}>Try again</Button>
      </div>
    );
  const { user, listings, bookings, admin, currency = "gbp" } = resource.data;
  const rentals = bookings.filter((b) => b.renterId === user.id);
  const incoming = bookings.filter(
    (b) => b.listing.ownerId === user.id || b.listing.owner.id === user.id,
  );
  const shownBookings =
    tab === "active"
      ? bookings.filter((b) =>
          [
            "CONFIRMED",
            "IN_USE",
            "RETURNED",
            "CLAIM_OPEN",
            "LOSS_RESOLVED",
            "SETTLING",
            "SETTLEMENT_FAILED",
          ].includes(b.status),
        )
      : tab === "incoming"
        ? incoming
        : tab === "admin"
          ? admin?.bookings || []
          : rentals;
  return (
    <div className="page dashboard">
      <div className="page-heading split">
        <div>
          <p className="eyebrow">YOUR AVIELLE</p>
          <h1>
            Hello, <em>{user.name.split(" ")[0]}.</em>
          </h1>
          <p>Your pieces, plans and possibilities. All in one place.</p>
        </div>
        <div className="button-row">
          <Link className="button outline" href="/profile">
            My profile
          </Link>
          <Link className="button" href="/list">
            <Plus size={17} />
            List a piece
          </Link>
        </div>
      </div>
      {params.get("created") && (
        <Notice kind="success">
          Your piece has been submitted. It will appear in the shared wardrobe
          once approved.
        </Notice>
      )}
      {params.get("updated") && (
        <Notice kind="success">Your changes were submitted for review.</Notice>
      )}
      {error && <Notice>{error}</Notice>}
      {resource.error && <Notice>{resource.error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      {!user.emailVerifiedAt && (
        <div className="account-banner">
          <div>
            <strong>One small step before your next chapter.</strong>
            <p>Verify {user.email} to request rentals or list pieces.</p>
          </div>
          <Button
            className="outline"
            busy={busy === "verify"}
            onClick={() =>
              void act(
                "verify",
                () => api("/api/auth", { action: "resend" }),
                "Verification email requested. Check your inbox and spam folder.",
              )
            }
          >
            Resend verification
          </Button>
        </div>
      )}
      <div className="dashboard-stats">
        <div>
          <span>Your pieces</span>
          <strong>{listings.length}</strong>
          <small>
            {listings.filter((l) => l.status === "ACTIVE").length} published
          </small>
        </div>
        <div>
          <span>Your rentals</span>
          <strong>{rentals.length}</strong>
          <small>
            {
              rentals.filter((b) =>
                ["APPROVED", "CONFIRMED", "IN_USE", "RETURNED"].includes(
                  b.status,
                ),
              ).length
            }{" "}
            awaiting your next step
          </small>
        </div>
        <div>
          <span>Lending requests</span>
          <strong>
            {incoming.filter((b) => b.status === "REQUESTED").length}
          </strong>
          <small>Waiting for a response</small>
        </div>
      </div>
      <section className="payout-banner">
        <span className="payout-icon">
          {user.payoutsEnabled ? (
            <CheckCircle2 size={23} />
          ) : (
            <Wallet size={23} />
          )}
        </span>
        <div>
          <strong>
            {user.payoutsEnabled
              ? "Your payout account is ready."
              : "A home for your earnings."}
          </strong>
          <p>
            {user.payoutsEnabled
              ? "Earnings are released after an inspected return and any claims are resolved."
              : "Connect your Stripe account before renters can pay for your pieces."}
          </p>
        </div>
        <Button
          className="outline"
          disabled={!user.emailVerifiedAt}
          busy={busy === "connect"}
          onClick={() =>
            void act("connect", async () => {
              const result = await api<{ url: string }>(
                "/api/payments/connect",
                {},
              );
              window.location.assign(result.url);
            })
          }
        >
          {user.payoutsEnabled ? "Payout settings" : "Set up payouts"}
          <ArrowUpRight size={15} />
        </Button>
        <button
          className="icon-button"
          aria-label="Refresh payout status"
          disabled={!!busy}
          onClick={() =>
            void act(
              "sync",
              async () => {
                await api("/api/payments/connect");
                await auth.refresh();
              },
              "Payout status refreshed.",
            )
          }
        >
          <RefreshCw size={17} className={busy === "sync" ? "spin" : ""} />
        </button>
      </section>
      <div className="tabs" role="tablist" aria-label="Wardrobe sections">
        {[
          { value: "rentals", label: "I’m renting", count: rentals.length },
          { value: "incoming", label: "I’m lending", count: incoming.length },
          { value: "listings", label: "My pieces", count: listings.length },
          {
            value: "active",
            label: "Active rentals",
            count: bookings.filter((b) =>
              [
                "CONFIRMED",
                "IN_USE",
                "RETURNED",
                "CLAIM_OPEN",
                "LOSS_RESOLVED",
                "SETTLING",
                "SETTLEMENT_FAILED",
              ].includes(b.status),
            ).length,
          },
          { value: "updates", label: "Updates", count: undefined },
          ...(admin
            ? [
                {
                  value: "admin",
                  label: "Operations",
                  count: admin.listings.filter((l) => l.status === "PENDING")
                    .length,
                },
              ]
            : []),
        ].map((t) => (
          <button
            key={t.value}
            role="tab"
            id={`tab-${t.value}`}
            aria-controls="wardrobe-panel"
            aria-selected={tab === t.value}
            onClick={() => setTab(t.value)}
          >
            {t.label}
            {t.count !== undefined && <span>{t.count}</span>}
          </button>
        ))}
      </div>
      <section
        id="wardrobe-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === "updates" ? (
          <Notifications />
        ) : tab === "listings" ? (
          listings.length ? (
            <div className="own-listings">
              {listings.map((listing) => (
                <article className="own-listing" key={listing.id}>
                  <Link
                    href={`/items/${listing.id}`}
                    className="own-listing-photo"
                  >
                    {listing.images[0] && (
                      <img src={listing.images[0]} alt={listing.title} />
                    )}
                  </Link>
                  <div>
                    <p className="eyebrow">{listing.brand}</p>
                    <Link href={`/items/${listing.id}`}>
                      <h3>{listing.title}</h3>
                    </Link>
                    <p>
                      Size {listing.size} · {money(listing.dailyRate, currency)}{" "}
                      / day · {listing.location}
                    </p>
                    <Status value={listing.status} />
                    {listing.moderationNote && (
                      <p className="moderation-note">
                        <strong>Review note:</strong> {listing.moderationNote}
                      </p>
                    )}
                  </div>
                  <div className="button-row">
                    <Link
                      className="button outline"
                      href={`/list?edit=${listing.id}`}
                    >
                      Edit & availability
                    </Link>
                    <Link
                      className="button outline"
                      href={`/items/${listing.id}`}
                    >
                      View piece
                    </Link>
                    {listing.status === "ACTIVE" && (
                      <Button
                        className="outline"
                        busy={busy === listing.id}
                        onClick={() =>
                          void act(
                            listing.id,
                            () =>
                              api(
                                `/api/listings/${listing.id}`,
                                { action: "pause" },
                                "PATCH",
                              ),
                            "Your listing is paused. Existing rentals still need to be completed.",
                          )
                        }
                      >
                        Pause
                      </Button>
                    )}
                    {["PAUSED", "REJECTED"].includes(listing.status) && (
                      <Button
                        busy={busy === listing.id}
                        onClick={() =>
                          void act(
                            listing.id,
                            () =>
                              api(
                                `/api/listings/${listing.id}`,
                                { action: "resubmit" },
                                "PATCH",
                              ),
                            "Your piece has been sent for review.",
                          )
                        }
                      >
                        Submit for review
                      </Button>
                    )}
                    {deleting === listing.id ? (
                      <>
                        <p className="small">
                          Remove this piece from your wardrobe? Rental records
                          will be retained.
                        </p>
                        <Button
                          className="danger"
                          busy={busy === listing.id}
                          onClick={() =>
                            void act(
                              listing.id,
                              async () => {
                                await api(
                                  `/api/listings/${listing.id}`,
                                  undefined,
                                  "DELETE",
                                );
                                setDeleting("");
                              },
                              "Your piece was removed from the wardrobe.",
                            )
                          }
                        >
                          Confirm delete
                        </Button>
                        <button
                          className="text-link underline"
                          onClick={() => setDeleting("")}
                        >
                          Keep piece
                        </button>
                      </>
                    ) : (
                      <button
                        className="text-link underline"
                        onClick={() => setDeleting(listing.id)}
                      >
                        Delete piece
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty
              title="Your wardrobe has potential."
              href="/list"
              action="List your first piece"
            >
              Start with a piece you love. Give it another occasion to be worn.
            </Empty>
          )
        ) : (
          <>
            {tab === "admin" && admin && (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">LISTING MODERATION</p>
                    <h2>Ready for a second look.</h2>
                  </div>
                </div>
                {admin.listings.filter((l) => l.status === "PENDING").length ? (
                  <div className="moderation-list">
                    {admin.listings
                      .filter((l) => l.status === "PENDING")
                      .map((listing) => (
                        <article
                          className="panel moderation-card"
                          key={listing.id}
                        >
                          <div className="moderation-overview">
                            {listing.images[0] && (
                              <img
                                src={listing.images[0]}
                                alt={listing.title}
                              />
                            )}
                            <div>
                              <p className="eyebrow">
                                {listing.brand} · {listing.owner?.name}
                              </p>
                              <h3>
                                <Link href={`/items/${listing.id}`}>
                                  {listing.title} <ArrowUpRight size={15} />
                                </Link>
                              </h3>
                              <p>
                                {listing.category} · {listing.size} ·{" "}
                                {listing.condition}
                              </p>
                              <p>
                                {money(listing.dailyRate, currency)} / day ·{" "}
                                {listing.location}
                              </p>
                            </div>
                          </div>
                          <Field label="Moderation note">
                            <textarea
                              value={notes[listing.id] || ""}
                              maxLength={1000}
                              onChange={(e) =>
                                setNotes({
                                  ...notes,
                                  [listing.id]: e.target.value,
                                })
                              }
                              rows={2}
                              placeholder="Explain changes needed, or record your review."
                            />
                          </Field>
                          <div className="button-row">
                            <Button
                              busy={busy === listing.id}
                              onClick={() =>
                                void act(
                                  listing.id,
                                  () =>
                                    api(
                                      `/api/listings/${listing.id}`,
                                      {
                                        action: "approve",
                                        moderationNote: notes[listing.id] || "",
                                      },
                                      "PATCH",
                                    ),
                                  "Listing approved and published.",
                                )
                              }
                            >
                              Approve & publish
                            </Button>
                            <Button
                              className="outline"
                              busy={busy === listing.id}
                              disabled={!notes[listing.id]?.trim()}
                              onClick={() =>
                                void act(
                                  listing.id,
                                  () =>
                                    api(
                                      `/api/listings/${listing.id}`,
                                      {
                                        action: "reject",
                                        moderationNote: notes[listing.id],
                                      },
                                      "PATCH",
                                    ),
                                  "Listing rejected. The owner can read your note.",
                                )
                              }
                            >
                              Reject with note
                            </Button>
                          </div>
                        </article>
                      ))}
                  </div>
                ) : (
                  <p className="panel muted">
                    There are no listings awaiting review.
                  </p>
                )}
                <div className="section-heading">
                  <h2>Rental operations.</h2>
                  <span className="small muted">
                    Open a booking to review claims and settlement.
                  </span>
                </div>
              </>
            )}
            {shownBookings.length ? (
              <div className="booking-list">
                {shownBookings.map((booking) => (
                  <BookingRow
                    key={booking.id}
                    booking={booking}
                    owner={booking.listing.ownerId === user.id}
                  />
                ))}
              </div>
            ) : (
              <Empty
                title={
                  tab === "incoming"
                    ? "Your next request will be right here."
                    : tab === "admin"
                      ? "No bookings to review."
                      : "Your next occasion awaits."
                }
                href={
                  tab === "incoming"
                    ? "/list"
                    : tab === "admin"
                      ? undefined
                      : "/explore"
                }
                action={
                  tab === "incoming" ? "List a piece" : "Explore the wardrobe"
                }
              >
                {tab === "incoming"
                  ? "When someone requests one of your pieces, you’ll find the details and next steps here."
                  : tab === "admin"
                    ? "Bookings will appear when members begin requesting rentals."
                    : "Find something you love and send your first rental request."}
              </Empty>
            )}
            {tab === "admin" && admin && (
              <details className="detail-section admin-members">
                <summary>Community accounts ({admin.users.length})</summary>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Email verified</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admin.users.map((u) => (
                        <tr key={u.id}>
                          <td>{u.name}</td>
                          <td>{u.email}</td>
                          <td>{u.role}</td>
                          <td>{u.emailVerifiedAt ? "Yes" : "No"}</td>
                          <td>{u.active === false ? "Suspended" : "Active"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </>
        )}
      </section>
    </div>
  );
}
function BookingRow({
  booking: b,
  owner,
}: {
  booking: Booking;
  owner: boolean;
}) {
  return (
    <Link className="booking-row" href={`/bookings/${b.id}`}>
      <div className="booking-thumb">
        {b.listing.images[0] && (
          <img src={b.listing.images[0]} alt={b.listing.title} />
        )}
      </div>
      <div className="booking-row-title">
        <p className="eyebrow">{b.listing.brand}</p>
        <h3>{b.listing.title}</h3>
        <p>
          {date(b.startDate)} – {date(b.endDate)}
        </p>
        <small>
          {owner
            ? `Rented by ${b.renter.name}`
            : `From ${b.listing.owner.name}’s wardrobe`}
        </small>
      </div>
      <div className="booking-row-status">
        <Status value={b.status} />
        {b.claim?.status === "OPEN" && <Status value="CLAIM_OPEN" />}
        <strong>{money(owner ? b.ownerEarnings : b.total, b.currency)}</strong>
        <small>{owner ? "Your earnings" : "Total incl. deposit"}</small>
      </div>
      <ArrowRight size={20} className="booking-row-arrow" />
    </Link>
  );
}
