"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pause, Play, Plus } from "lucide-react";
import { Booking, Listing, money, User } from "./shared";

export type DashboardRating = { value: number; count: number };
export type SpotlightCreator = {
  id: string;
  name: string;
  bio?: string;
  location?: string;
};

export function DashboardHero({
  user,
  feature,
}: {
  user: User;
  feature?: Listing;
}) {
  const image = feature?.images[0];
  const [paused, setPaused] = useState(false);
  return (
    <section
      className="dashboard-editorial-hero"
      aria-labelledby="dashboard-title"
      data-motion={paused ? "paused" : "playing"}
    >
      <div className="dashboard-hero-copy">
        <p className="eyebrow">YOUR AVIELLE · THE WARDROBE JOURNAL</p>
        <h1 id="dashboard-title">
          Hello, <em>{user.name.trim().split(/\s+/)[0]}.</em>
        </h1>
        <p className="dashboard-hero-introduction">
          Your pieces, plans and possibilities. A wardrobe with a life of its
          own.
        </p>
        <div className="button-row">
          <Link className="button outline" href="/profile">
            My profile
          </Link>
          <Link className="button" href="/list">
            <Plus size={17} aria-hidden="true" />
            List a piece
          </Link>
        </div>
        <span className="dashboard-hero-footnote">
          Good pieces deserve another occasion.
        </span>
      </div>
      <figure className="dashboard-hero-visual">
        <button
          type="button"
          className="dashboard-motion-toggle"
          aria-label={paused ? "Resume image motion" : "Pause image motion"}
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? (
            <Play size={13} aria-hidden="true" />
          ) : (
            <Pause size={13} aria-hidden="true" />
          )}{" "}
          {paused ? "Resume" : "Pause"} motion
        </button>
        <img
          src={image || "/images/hero.jpg"}
          alt={image ? feature!.title : "Avielle fashion editorial"}
          width={800}
          height={1000}
          decoding="async"
          loading="lazy"
          className="dashboard-hero-image"
        />
        <figcaption className="dashboard-hero-caption">
          <span>{image ? "FROM YOUR WARDROBE" : "THE AVIELLE EDIT"}</span>
          <strong>{image ? feature!.title : "Style, shared."}</strong>
          {image ? (
            <Link href={`/items/${feature!.id}`}>
              View piece <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          ) : (
            <small>Editorial image</small>
          )}
        </figcaption>
      </figure>
    </section>
  );
}

type NumberStyle = "number" | "money" | "percent" | "rating";
function formatMetric(value: number, style: NumberStyle, currency: string) {
  if (style === "money") return money(Math.round(value), currency);
  if (style === "percent") return `${Math.round(value)}%`;
  if (style === "rating") return `${value.toFixed(1)} / 5`;
  return Math.round(value).toLocaleString("en-GB");
}

function CountUp({
  value,
  style = "number",
  currency,
}: {
  value: number;
  style?: NumberStyle;
  currency: string;
}) {
  const [displayed, setDisplayed] = useState(value);
  const anchor = useRef<HTMLSpanElement>(null);
  const animated = useRef(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const showFinal = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      animated.current = true;
      setDisplayed(value);
    };
    const onMotionChange = () => {
      if (motion.matches) showFinal();
    };
    motion.addEventListener("change", onMotionChange);
    if (
      motion.matches ||
      animated.current ||
      !("IntersectionObserver" in window)
    ) {
      showFinal();
    } else if (anchor.current) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting || animated.current) return;
          observer?.disconnect();
          animated.current = true;
          if (motion.matches) return showFinal();
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / 500, 1);
            setDisplayed(value * (1 - Math.pow(1 - progress, 3)));
            if (progress < 1) frame = requestAnimationFrame(tick);
          };
          frame = requestAnimationFrame(tick);
        },
        { threshold: 0.25 },
      );
      observer.observe(anchor.current);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      motion.removeEventListener("change", onMotionChange);
    };
  }, [value]);
  return (
    <>
      <span ref={anchor} aria-hidden="true">
        {formatMetric(displayed, style, currency)}
      </span>
      <span className="sr-only">{formatMetric(value, style, currency)}</span>
    </>
  );
}

type Metric = {
  label: string;
  value: number | null;
  style?: NumberStyle;
  hint: string;
};
export function DashboardMetrics({
  user,
  listings,
  bookings,
  currency,
  mode,
  savedCount,
  rating,
}: {
  user: User;
  listings: Listing[];
  bookings: Booking[];
  currency: string;
  mode: "renting" | "lending";
  savedCount: number;
  rating?: DashboardRating;
}) {
  const incoming = bookings.filter((b) => b.listing.ownerId === user.id);
  const rentals = bookings.filter((b) => b.renterId === user.id);
  const approvedStates = [
    "APPROVED",
    "CHECKOUT_PENDING",
    "CONFIRMED",
    "IN_USE",
    "RETURNED",
    "CLAIM_OPEN",
    "LOSS_RESOLVED",
    "SETTLING",
    "SETTLEMENT_FAILED",
    "COMPLETED",
  ];
  const confirmedStates = approvedStates.filter(
    (status) => !["APPROVED", "CHECKOUT_PENDING"].includes(status),
  );
  const today = new Date().toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const metrics: Metric[] =
    mode === "lending"
      ? [
          {
            label: "Released earnings",
            value: incoming
              .filter(
                (b) =>
                  b.payoutStatus === "TRANSFERRED" &&
                  b.currency.toLowerCase() === currency.toLowerCase(),
              )
              .reduce((sum, b) => sum + b.ownerEarnings, 0),
            style: "money",
            hint: "Rental earnings transferred to Stripe. Excludes deposit awards.",
          },
          {
            label: "Published pieces",
            value: listings.filter(
              (l) => l.ownerId === user.id && l.status === "ACTIVE",
            ).length,
            hint: "Available in your shared wardrobe.",
          },
          {
            label: "Confirmed rentals",
            value: incoming.filter((b) => confirmedStates.includes(b.status))
              .length,
            hint: "Paid rentals, including completed returns.",
          },
          {
            label: "Booking conversion",
            value: incoming.length
              ? (incoming.filter((b) => confirmedStates.includes(b.status))
                  .length /
                  incoming.length) *
                100
              : null,
            style: "percent",
            hint: "Confirmed or further along, out of all loaded requests.",
          },
          {
            label: "Community rating",
            value: rating && rating.count > 0 ? rating.value : null,
            style: "rating",
            hint:
              rating && rating.count > 0
                ? `From ${rating.count} received ${rating.count === 1 ? "review" : "reviews"}.`
                : "Your first completed review will appear here.",
          },
        ]
      : [
          {
            label: "Active rentals",
            value: rentals.filter((b) =>
              ["CONFIRMED", "IN_USE"].includes(b.status),
            ).length,
            hint: "Confirmed or currently in your wardrobe.",
          },
          {
            label: "Upcoming returns",
            value: rentals.filter(
              (b) =>
                b.status === "IN_USE" &&
                b.endDate.slice(0, 10) >= today &&
                b.endDate.slice(0, 10) <= nextWeek,
            ).length,
            hint: "In-use pieces due within the next 7 days.",
          },
          {
            label: "Saved pieces",
            value: savedCount,
            hint: "Saved on this device. Your personal shortlist.",
          },
          {
            label: "Rental activity",
            value: rentals.length,
            hint: "Requests in your current rental history.",
          },
        ];
  return (
    <section
      className="dashboard-metrics-section"
      aria-label={
        mode === "lending" ? "Your lending overview" : "Your renting overview"
      }
    >
      <dl className="dashboard-editorial-metrics">
        {metrics.map((metric) => (
          <div key={metric.label} className="dashboard-metric">
            <dt>{metric.label}</dt>
            <dd className="dashboard-metric-value">
              {metric.value === null ? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">Not available yet</span>
                </>
              ) : (
                <CountUp
                  value={metric.value}
                  style={metric.style}
                  currency={currency}
                />
              )}
            </dd>
            <dd className="dashboard-metric-hint">{metric.hint}</dd>
          </div>
        ))}
      </dl>
      <p className="dashboard-metrics-note">
        Rental figures reflect your latest 100 loaded booking records.
      </p>
    </section>
  );
}

export function CreatorSpotlight({
  listing,
  creator,
}: {
  listing?: Listing;
  creator?: SpotlightCreator;
}) {
  const published = listing?.status === "ACTIVE" ? listing : undefined;
  const member: SpotlightCreator | undefined = published
    ? creator?.id === published.ownerId
      ? creator
      : published.owner
    : undefined;
  return (
    <section
      className={`creator-spotlight${published ? "" : " creator-spotlight-empty"}`}
      aria-labelledby="creator-spotlight-title"
    >
      <figure className="creator-spotlight-visual">
        <img
          src={published?.images[0] || "/images/hero.jpg"}
          alt={
            published?.images[0] ? published.title : "Avielle fashion editorial"
          }
          width={800}
          height={1000}
          loading="lazy"
          decoding="async"
        />
        <figcaption>
          {published?.images[0] ? published.brand : "Editorial image"}
        </figcaption>
      </figure>
      <div className="creator-spotlight-copy">
        <p className="eyebrow">
          {member ? "A CLOSET TO KNOW" : "THE NEXT CHAPTER"}
        </p>
        <h2 id="creator-spotlight-title">
          {member ? (
            <>
              Inside <em>{member.name}’s</em> wardrobe.
            </>
          ) : (
            <>
              Every closet has <em>a story.</em>
            </>
          )}
        </h2>
        <p>
          {member?.bio ||
            (member
              ? "Discover the pieces they’re sharing with the Avielle community."
              : "Share yours. Introduce your style, your favourite pieces, and the occasions they’re ready for.")}
        </p>
        {member?.location && <p className="small muted">{member.location}</p>}
        <Link
          className="button outline"
          href={member ? `/members/${member.id}` : "/profile"}
        >
          {member ? "Explore closet" : "Introduce your closet"}
          <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
        {published && (
          <p className="creator-spotlight-piece">Featuring {published.title}</p>
        )}
      </div>
    </section>
  );
}
