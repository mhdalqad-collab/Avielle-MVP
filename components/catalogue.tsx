"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Heart,
  MapPin,
  Search,
  SlidersHorizontal,
  Star,
} from "lucide-react";
import { AvailabilityCalendar } from "./availability";
import { useSavedWardrobe } from "./saved-wardrobe";
import {
  api,
  Button,
  Catalogue,
  categories,
  date,
  Empty,
  errorMessage,
  Field,
  Listing,
  Loading,
  money,
  Notice,
  Status,
  today,
  useAuth,
  useResource,
} from "./shared";

export function ListingCard({
  listing,
  currency,
}: {
  listing: Listing;
  currency: string;
}) {
  const saved = useSavedWardrobe();
  const [previewRequested, setPreviewRequested] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<
    "saved" | "removed" | "error" | ""
  >("");
  const isSaved = saved.isSaved(listing.id);
  const secondImage =
    listing.images[1] !== listing.images[0] ? listing.images[1] : null;
  return (
    <article className={`garment-card${isSaved ? " is-saved" : ""}`}>
      <Link
        href={`/items/${listing.id}`}
        className={`listing-card${previewReady ? " is-preview-ready" : ""}`}
        onMouseEnter={() => setPreviewRequested(true)}
        onFocus={() => setPreviewRequested(true)}
      >
        <div className="listing-card-image">
          {listing.images[0] ? (
            <img
              className="garment-image-primary"
              src={listing.images[0]}
              alt={listing.title}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="image-placeholder">Photo unavailable</div>
          )}
          {previewRequested && secondImage && (
            <img
              className="garment-image-secondary"
              src={secondImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              onLoad={() => setPreviewReady(true)}
            />
          )}
          <span className="listing-size">{listing.size}</span>
        </div>
        <div className="listing-card-info">
          <p className="eyebrow">{listing.brand}</p>
          <h3>{listing.title}</h3>
          <p className="location">
            <MapPin size={13} />
            {listing.location}
          </p>
          <div className="listing-card-bottom">
            <span>
              <strong>{money(listing.dailyRate, currency)}</strong> / day
            </span>
            <ArrowRight size={17} aria-hidden="true" />
          </div>
        </div>
      </Link>
      <button
        type="button"
        className="garment-save"
        aria-label={`${isSaved ? "Remove" : "Save"} ${listing.title}${isSaved ? " from saved pieces" : " on this device"}`}
        aria-pressed={isSaved}
        disabled={!saved.ready}
        title={isSaved ? "Saved on this device" : "Save on this device"}
        onClick={() => {
          const success = saved.toggle(listing.id);
          setSaveFeedback(success ? (isSaved ? "removed" : "saved") : "error");
        }}
      >
        <Heart
          size={18}
          strokeWidth={1.5}
          fill={isSaved ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
      <p
        className={`garment-save-note${saveFeedback === "error" ? " has-error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {saveFeedback === "error"
          ? saved.error || "This piece could not be saved. Please try again."
          : saveFeedback === "saved" && isSaved
            ? "Saved on this device"
            : saveFeedback === "removed" && !isSaved
              ? "Removed from saved pieces"
              : ""}
      </p>
    </article>
  );
}

export function ExplorePage() {
  const params = useSearchParams();
  const router = useRouter();
  const query = params.toString();
  const resource = useResource<Catalogue>(
    `/api/listings${query ? `?${query}` : ""}`,
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterStart, setFilterStart] = useState(params.get("dateFrom") || "");
  return (
    <div className="page explore">
      <div className="page-heading">
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h1>
          The shared <em>wardrobe.</em>
        </h1>
        <p>
          Find a piece to fall for. Wear it your way. Pass the possibility on.
        </p>
      </div>
      <form
        key={query}
        className="searchbar"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const next = new URLSearchParams();
          for (const [key, value] of data)
            if (String(value).trim()) next.set(key, String(value).trim());
          router.push(`/explore${next.size ? `?${next}` : ""}`);
        }}
      >
        <div className="search-input">
          <Search size={20} />
          <input
            name="q"
            aria-label="Search the wardrobe"
            defaultValue={params.get("q") || ""}
            placeholder="A designer, a piece, a possibility…"
            maxLength={120}
          />
        </div>
        <button
          type="button"
          className="filter-toggle"
          aria-expanded={filtersOpen}
          aria-controls="catalogue-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={17} /> Filters
        </button>
        <Button>
          Search <ArrowRight size={17} />
        </Button>
        <div
          id="catalogue-filters"
          className={`filter-fields ${filtersOpen ? "open" : ""}`}
        >
          <Field label="Category">
            <select name="category" defaultValue={params.get("category") || ""}>
              <option value="">All pieces</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size">
            <input
              name="size"
              defaultValue={params.get("size") || ""}
              placeholder="e.g. UK 10, M"
              maxLength={40}
            />
          </Field>
          <Field label="Pickup area">
            <input
              name="location"
              defaultValue={params.get("location") || ""}
              placeholder="Town or neighbourhood"
              maxLength={100}
            />
          </Field>
          <Field label="From">
            <input
              type="date"
              name="dateFrom"
              defaultValue={params.get("dateFrom") || ""}
              onChange={(e) => setFilterStart(e.target.value)}
              min={today()}
            />
          </Field>
          <Field label="Until">
            <input
              type="date"
              name="dateTo"
              defaultValue={params.get("dateTo") || ""}
              min={filterStart || today()}
            />
          </Field>
        </div>
      </form>
      <div className="catalogue-toolbar">
        <span>
          {resource.loading
            ? "Finding your next piece…"
            : resource.data
              ? `${resource.data.listings.length} ${resource.data.listings.length === 1 ? "piece" : "pieces"} to discover`
              : "The wardrobe"}
        </span>
        {query ? (
          <Link href="/explore" className="text-link underline">
            Clear all filters
          </Link>
        ) : (
          <span>Shared with care. Collected locally.</span>
        )}
      </div>
      {resource.loading ? (
        <div
          className="catalogue-skeleton"
          aria-label="Loading wardrobe"
          role="status"
        >
          {[1, 2, 3, 4].map((n) => (
            <div key={n} />
          ))}
        </div>
      ) : resource.error ? (
        <div className="resource-error">
          <Notice>{resource.error}</Notice>
          <Button className="outline" onClick={() => void resource.refresh()}>
            Try again
          </Button>
        </div>
      ) : resource.data?.listings.length ? (
        <div className="listing-grid">
          {resource.data.listings.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              currency={resource.data!.currency}
            />
          ))}
        </div>
      ) : (
        <Empty
          title={
            query
              ? "Nothing quite like that. Yet."
              : "Good things start with one piece."
          }
          href={query ? "/explore" : "/list"}
          action={query ? "Explore all pieces" : "Be the first to share"}
        >
          {query
            ? "Try a different size, a nearby area, or a little more flexibility with your dates."
            : "Our shared wardrobe is just beginning. Have something beautiful waiting for its next moment? Give it a place here."}
        </Empty>
      )}
      <div className="catalogue-note">
        <Check size={17} />
        <p>
          Real pieces from real wardrobes. Every rental begins with a lender’s
          acceptance.
        </p>
      </div>
    </div>
  );
}

type ItemResponse = {
  listing: Listing;
  blockedDates?: { startDate: string; endDate: string }[];
  currency: string;
  commissionBps: number;
  renterFeeBps: number;
  paymentsReady: boolean;
};
export function ItemPage({ id }: { id: string }) {
  const resource = useResource<ItemResponse>(
    `/api/listings/${encodeURIComponent(id)}`,
  );
  const auth = useAuth();
  const router = useRouter();
  const [image, setImage] = useState(0);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (resource.loading)
    return (
      <div className="page">
        <Loading text="Finding your piece…" />
      </div>
    );
  if (resource.error || !resource.data)
    return (
      <div className="page narrow">
        <Notice>{resource.error || "This piece is unavailable."}</Notice>
        <Link className="button outline" href="/explore">
          Back to the wardrobe
        </Link>
      </div>
    );
  const { listing, currency = "gbp", renterFeeBps } = resource.data;
  const days =
    start && end && end >= start
      ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
      : 0;
  const rental = days * listing.dailyRate;
  const fee =
    typeof renterFeeBps === "number"
      ? Math.round((rental * renterFeeBps) / 10000)
      : null;
  const blocked = resource.data.blockedDates || listing.blockedDates || [];
  const overlap =
    !!start &&
    !!end &&
    blocked.some((d) => start <= d.endDate && end >= d.startDate);
  const isOwner =
    auth.user?.id === listing.ownerId || auth.user?.id === listing.owner.id;
  return (
    <div className="page item-page">
      <Link href="/explore" className="back-link">
        <ArrowLeft size={16} />
        Back to the wardrobe
      </Link>
      <div className="item-grid">
        <div className="item-gallery">
          <div className="item-main-image">
            {listing.images[image] ? (
              <img
                src={listing.images[image]}
                alt={`${listing.title}, view ${image + 1}`}
              />
            ) : (
              <div className="image-placeholder">Photo unavailable</div>
            )}
          </div>
          {listing.images.length > 1 && (
            <div className="item-thumbnails">
              {listing.images.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setImage(i)}
                  aria-label={`View photo ${i + 1}`}
                  aria-pressed={image === i}
                >
                  <img src={src} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="item-information">
          <p className="eyebrow">{listing.brand}</p>
          <h1>{listing.title}</h1>
          <div className="item-meta">
            <span>Size {listing.size}</span>
            <span>{listing.condition}</span>
          </div>
          <p className="location">
            <MapPin size={16} />
            {listing.location} · Local pickup
          </p>
          {listing.status !== "ACTIVE" && <Status value={listing.status} />}
          <p className="item-description preserve">{listing.description}</p>
          <div className="owner-line">
            <span className="avatar large">{listing.owner.name.charAt(0)}</span>
            <div>
              <small>From the wardrobe of</small>
              <Link
                className="text-link underline"
                href={`/members/${listing.owner.id}`}
              >
                {listing.owner.name}
              </Link>
            </div>
          </div>
          <div className="rental-box">
            <div className="rental-price">
              <strong>{money(listing.dailyRate, currency)}</strong>
              <span> / day</span>
            </div>
            <p className="small">
              Available {date(listing.availableFrom)} –{" "}
              {date(listing.availableTo)}
            </p>
            {isOwner ? (
              <>
                <Notice kind="info">
                  This is your piece. Manage requests and publication from your
                  wardrobe.
                </Notice>
                <Link className="button full" href="/dashboard">
                  Go to my wardrobe <ArrowRight size={16} />
                </Link>
              </>
            ) : listing.status !== "ACTIVE" ? (
              <Notice kind="info">
                This piece is not currently available for rental.
              </Notice>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setError("");
                  if (!auth.user) {
                    router.push(
                      `/login?next=${encodeURIComponent(`/items/${id}`)}`,
                    );
                    return;
                  }
                  if (!auth.user.emailVerifiedAt) {
                    setError(
                      "Verify your email before requesting a rental. You can resend your verification email from My wardrobe.",
                    );
                    return;
                  }
                  setBusy(true);
                  try {
                    const result = await api<{ booking: { id: string } }>(
                      "/api/bookings",
                      { listingId: id, startDate: start, endDate: end },
                    );
                    router.push(`/bookings/${result.booking.id}`);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <AvailabilityCalendar
                  availableFrom={listing.availableFrom}
                  availableTo={listing.availableTo}
                  blockedDates={blocked}
                  start={start}
                  end={end}
                  onSelect={(value) => {
                    if (!start || end || value < start) {
                      setStart(value);
                      setEnd("");
                    } else setEnd(value);
                  }}
                />
                <div className="form-grid">
                  <Field label="Pickup date">
                    <input
                      type="date"
                      required
                      value={start}
                      min={
                        listing.availableFrom > today()
                          ? listing.availableFrom
                          : today()
                      }
                      max={listing.availableTo}
                      onChange={(e) => {
                        setStart(e.target.value);
                        if (end && e.target.value > end) setEnd("");
                      }}
                    />
                  </Field>
                  <Field label="Return date">
                    <input
                      type="date"
                      required
                      value={end}
                      min={
                        start ||
                        (listing.availableFrom > today()
                          ? listing.availableFrom
                          : today())
                      }
                      max={listing.availableTo}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                  </Field>
                </div>
                {days > 0 && fee !== null && (
                  <div className="costs">
                    <div>
                      <span>
                        {money(listing.dailyRate, currency)} × {days}{" "}
                        {days === 1 ? "day" : "days"}
                      </span>
                      <span>{money(rental, currency)}</span>
                    </div>
                    <div>
                      <span>Cleaning</span>
                      <span>{money(listing.cleaningFee, currency)}</span>
                    </div>
                    <div>
                      <span>Service fee ({renterFeeBps / 100}%)</span>
                      <span>{money(fee, currency)}</span>
                    </div>
                    <div>
                      <span>Refundable deposit</span>
                      <span>{money(listing.deposit, currency)}</span>
                    </div>
                    <div className="total">
                      <strong>Total at checkout</strong>
                      <strong>
                        {money(
                          rental + listing.cleaningFee + fee + listing.deposit,
                          currency,
                        )}
                      </strong>
                    </div>
                  </div>
                )}
                {overlap && (
                  <Notice>
                    These dates overlap another reservation. Choose different
                    dates.
                  </Notice>
                )}
                {error && <Notice>{error}</Notice>}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    required
                    checked={accepted}
                    onChange={(e) => setAccepted(e.target.checked)}
                  />
                  <span>
                    I’ve read the{" "}
                    <Link href="/terms" target="_blank">
                      rental terms
                    </Link>
                    . Pickup is local and the refundable deposit is charged with
                    payment.
                  </span>
                </label>
                <Button
                  className="full"
                  busy={busy}
                  disabled={overlap || !days || !accepted}
                >
                  {auth.user ? "Request to rent" : "Sign in to request"}
                  <ArrowRight size={17} />
                </Button>
                <p className="small center rental-note">
                  No charge now. Pay only after the lender accepts.
                </p>
              </form>
            )}
          </div>
          <details className="detail-section" open>
            <summary>Fit & details</summary>
            <dl>
              <div>
                <dt>Size</dt>
                <dd>{listing.size}</dd>
              </div>
              <div>
                <dt>Measurements</dt>
                <dd>
                  {listing.measurements ||
                    "Ask the lender for additional measurements."}
                </dd>
              </div>
              <div>
                <dt>Category</dt>
                <dd>{listing.category}</dd>
              </div>
              <div>
                <dt>Condition</dt>
                <dd>{listing.condition}</dd>
              </div>
            </dl>
          </details>
          <details className="detail-section">
            <summary>Collection, return & care</summary>
            <p>
              Arrange local pickup through your booking conversation. Condition
              photos are recorded before handover and after return. Follow the
              lender’s care instructions and return by your agreed date.
            </p>
          </details>
          {blocked.length > 0 && (
            <details className="detail-section">
              <summary>
                <span>Unavailable dates</span>
              </summary>
              <ul>
                {blocked.map((range, i) => (
                  <li key={i}>
                    {date(range.startDate)} – {date(range.endDate)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      <section className="item-reviews">
        <p className="eyebrow">FROM THE COMMUNITY</p>
        <h2>Every piece has a story.</h2>
        {listing.reviews?.length ? (
          <div className="review-grid">
            {listing.reviews.map((review) => (
              <article className="panel" key={review.id}>
                <div
                  className="review-stars"
                  aria-label={`${review.rating} out of 5 stars`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      key={i}
                      size={15}
                      fill={i < review.rating ? "currentColor" : "none"}
                    />
                  ))}
                </div>
                <p className="preserve">{review.comment}</p>
                <small>{date(review.createdAt)}</small>
              </article>
            ))}
          </div>
        ) : (
          <p>This piece hasn’t received a completed rental review yet.</p>
        )}
      </section>
    </div>
  );
}
