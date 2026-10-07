"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Notifications, type NotificationData } from "./notifications";
import {
  DashboardHero,
  DashboardMetrics,
  CreatorSpotlight,
} from "./dashboard-editorial";
import { ClosetActivity } from "./closet-activity";
import { WardrobeRail } from "./wardrobe-rail";
import { useSavedWardrobe } from "./saved-wardrobe";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import {
  api,
  Booking,
  Catalogue,
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
  const updates = useResource<NotificationData>("/api/notifications");
  const catalogue = useResource<Catalogue>("/api/listings");
  const member = useResource<{
    profile: {
      id: string;
      name: string;
      bio: string;
      location: string;
      reviews: { rating: number }[];
    };
  }>(auth.user ? `/api/members/${auth.user.id}` : null);
  const saved = useSavedWardrobe();
  const savedPool = useMemo(
    () => [
      ...(resource.data?.listings || []),
      ...(catalogue.data?.listings || []),
    ],
    [resource.data, catalogue.data],
  );
  const savedPieces = useSavedPieces(
    saved.ids,
    savedPool,
    catalogue.loading && !catalogue.data,
  );
  const featured =
    catalogue.data?.listings.find(
      (l) => l.ownerId !== auth.user?.id && l.images[0],
    ) || catalogue.data?.listings.find((l) => l.images[0]);
  const creator = useResource<{
    profile: { id: string; name: string; bio: string; location: string };
  }>(
    featured && featured.ownerId !== auth.user?.id
      ? `/api/members/${featured.ownerId}`
      : null,
  );
  const [tab, setTab] = useState("rentals");
  const [perspective, setPerspective] = useState<"renting" | "lending">(
    "renting",
  );
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        void resource.refresh();
        void updates.refresh();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [resource.refresh, updates.refresh]);
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
  const reviews = member.data?.profile.reviews || [];
  const rating = reviews.length
    ? {
        value: reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length,
        count: reviews.length,
      }
    : undefined;
  const railPieces = listings.length
    ? listings.slice(0, 12)
    : (catalogue.data?.listings || [])
        .filter((l) => l.ownerId !== user.id)
        .slice(0, 12);
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
      <DashboardHero user={user} feature={listings.find((l) => l.images[0])} />
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
      <DashboardMetrics
        user={user}
        listings={listings}
        bookings={bookings}
        currency={currency}
        mode={perspective}
        savedCount={saved.ids.length}
        rating={rating}
      />
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
            tabIndex={tab === t.value ? 0 : -1}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const tabs = Array.from(
                event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                ),
              );
              const index = tabs.indexOf(event.currentTarget);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              tabs[next].focus();
              tabs[next].click();
            }}
            onClick={() => {
              setTab(t.value);
              if (t.value === "rentals") setPerspective("renting");
              if (t.value === "incoming" || t.value === "listings")
                setPerspective("lending");
            }}
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
          <Notifications resource={updates} />
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
      <div className="dashboard-journal">
        <ClosetActivity
          bookings={bookings}
          notifications={updates.data?.notifications || []}
          loading={updates.loading}
          error={updates.error}
        />
        <CreatorSpotlight
          listing={featured}
          creator={
            featured?.ownerId === user.id
              ? member.data?.profile
              : creator.data?.profile
          }
        />
      </div>
      {railPieces.length ? (
        <WardrobeRail
          title={
            listings.length ? "Your digital wardrobe" : "A new wardrobe awaits"
          }
          eyebrow={
            listings.length
              ? "COLLECTED BY YOU, SHARED WITH CARE"
              : "PIECES WITH ANOTHER CHAPTER"
          }
          description={
            listings.length
              ? "Your pieces, side by side. Manage publication and availability in My pieces above."
              : "Discover what the community is sharing. Each piece leads to its real dates and details."
          }
          listings={railPieces}
          currency={currency}
          href={listings.length ? `/members/${user.id}` : "/explore"}
          action={
            listings.length ? "View public closet" : "Explore the wardrobe"
          }
        />
      ) : (
        <section className="wardrobe-rail-empty">
          <p className="eyebrow">A LITTLE SPACE FOR POSSIBILITY</p>
          <h2>
            Your wardrobe starts <em>with one piece.</em>
          </h2>
          <p>Shared pieces will appear here when they are published.</p>
          <Link href="/explore" className="text-link underline">
            Explore the wardrobe <ArrowUpRight size={16} />
          </Link>
        </section>
      )}
      {saved.ids.length > 0 && (
        <section
          className="saved-pieces-section"
          aria-label="Saved on this device"
        >
          <WardrobeRail
            title="Saved on this device"
            eyebrow="YOUR PERSONAL SHORTLIST"
            description="A few pieces to return to. Saved in this browser for your account; availability comes from the live wardrobe."
            listings={savedPieces.listings}
            currency={currency}
          />
          {savedPieces.loading && (
            <p role="status" className="muted">
              Opening your saved pieces…
            </p>
          )}
          {savedPieces.unavailable && (
            <p className="muted">
              Some saved pieces are unavailable. Your bookmarks stay on this
              device.
            </p>
          )}
          {saved.error && <Notice>{saved.error}</Notice>}
          <button
            className="text-link underline"
            onClick={() => saved.ids.forEach((id) => saved.remove(id))}
          >
            Clear saved pieces
          </button>
        </section>
      )}
    </div>
  );
}
function useSavedPieces(ids: string[], pool: Listing[], wait: boolean) {
  const [result, setResult] = useState<{
    listings: Listing[];
    loading: boolean;
    unavailable: boolean;
  }>({ listings: [], loading: false, unavailable: false });
  const idsKey = ids.join(",");
  useEffect(() => {
    const controller = new AbortController();
    if (!ids.length) {
      setResult({ listings: [], loading: false, unavailable: false });
      return;
    }
    if (wait) return;
    const found = new Map(pool.map((listing) => [listing.id, listing]));
    const missing = ids.filter((id) => !found.has(id));
    setResult({
      listings: ids.flatMap((id) => (found.has(id) ? [found.get(id)!] : [])),
      loading: missing.length > 0,
      unavailable: false,
    });
    if (missing.length)
      void Promise.allSettled(
        missing.map(async (id) => {
          const response = await fetch(`/api/listings/${id}`, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Unavailable piece");
          const body = await response.json();
          if (body.listing?.id === id && body.listing.status !== "DELETED")
            return body.listing as Listing;
          throw new Error("Unavailable piece");
        }),
      ).then((results) => {
        if (controller.signal.aborted) return;
        results.forEach((value) => {
          if (value.status === "fulfilled")
            found.set(value.value.id, value.value);
        });
        setResult({
          listings: ids.flatMap((id) =>
            found.has(id) ? [found.get(id)!] : [],
          ),
          loading: false,
          unavailable: results.some((value) => value.status === "rejected"),
        });
      });
    return () => controller.abort();
  }, [idsKey, pool, wait]);
  return result;
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
