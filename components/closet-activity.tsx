"use client";

import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Check,
  MessageCircle,
  Plus,
  Wallet,
} from "lucide-react";
import { type Booking, date } from "./shared";
import type { Notification } from "./notifications";

type Activity = {
  id: string;
  title: string;
  detail: string;
  bookingId: string;
  timestamp?: string;
  due?: boolean;
  icon: "calendar" | "message" | "wallet" | "check" | "request";
};
function iconFor(title: string): Activity["icon"] {
  if (/message/i.test(title)) return "message";
  if (/settle|transfer|refund|payment/i.test(title)) return "wallet";
  if (/approve|confirm|complete|return/i.test(title)) return "check";
  return "request";
}
function activityTitle(title: string) {
  const titles: Record<string, string> = {
    requested: "A new rental request",
    approved: "Booking accepted",
    declined: "Request declined",
    "payment confirmed": "Rental confirmed",
    "in use": "A piece is out in the world",
    returned: "A piece has been returned",
    completed: "Rental completed",
    "settlement complete": "Earnings transferred",
    "new message": "A note in your conversation",
  };
  return (
    titles[title.toLowerCase()] ||
    title.charAt(0).toUpperCase() + title.slice(1)
  );
}
export function ClosetActivity({
  bookings,
  notifications,
  loading,
  error,
}: {
  bookings: Booking[];
  notifications: Notification[];
  loading?: boolean;
  error?: string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const due: Activity[] = bookings
    .filter((b) => b.status === "IN_USE")
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .slice(0, 2)
    .map((b) => ({
      id: `due-${b.id}`,
      bookingId: b.id,
      title: b.endDate < today ? "Return overdue" : "Return due",
      detail: `${b.listing.title} · currently rented`,
      timestamp: b.endDate,
      due: true,
      icon: "calendar",
    }));
  const recent: Activity[] = notifications
    .filter((n) => n.bookingId)
    .slice(0, 6)
    .map((n) => ({
      id: n.id,
      bookingId: n.bookingId!,
      title:
        n.title.toLowerCase() === "completed" &&
        bookings.some(
          (b) => b.id === n.bookingId && b.payoutStatus === "TRANSFERRED",
        )
          ? "Rental settled · lender transfer confirmed"
          : activityTitle(n.title),
      detail: n.body,
      timestamp: n.createdAt,
      icon: iconFor(n.title),
    }));
  // State summaries have no invented event timestamp. The full audit history stays in the booking.
  const states: Activity[] = bookings
    .filter(
      (b) =>
        !recent.some((n) => n.bookingId === b.id) &&
        !due.some((n) => n.bookingId === b.id),
    )
    .filter((b) =>
      ["REQUESTED", "APPROVED", "CONFIRMED", "COMPLETED"].includes(b.status),
    )
    .slice(0, 4)
    .map((b) => ({
      id: `state-${b.id}`,
      bookingId: b.id,
      title:
        b.payoutStatus === "TRANSFERRED"
          ? "Earnings transferred"
          : b.status === "REQUESTED"
            ? "Booking requested"
            : b.status === "APPROVED"
              ? "Booking accepted"
              : b.status === "CONFIRMED"
                ? "Rental confirmed"
                : "Rental completed",
      detail: b.listing.title,
      timestamp: b.status === "REQUESTED" ? b.createdAt : undefined,
      icon:
        b.payoutStatus === "TRANSFERRED"
          ? "wallet"
          : b.status === "REQUESTED"
            ? "request"
            : "check",
    }));
  const entries = [...due, ...recent, ...states].slice(0, 7);
  const icons = {
    calendar: CalendarDays,
    message: MessageCircle,
    wallet: Wallet,
    check: Check,
    request: Plus,
  };
  return (
    <section
      className="closet-activity"
      aria-labelledby="closet-activity-heading"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">THE STORIES BETWEEN OCCASIONS</p>
          <h2 id="closet-activity-heading">
            Your closet, <em>in motion.</em>
          </h2>
        </div>
      </div>
      <p className="muted activity-intro">
        Rental updates, conversations and the next return. Open a rental for its
        full history.
      </p>
      {error && (
        <p role="status" className="muted">
          Updates are temporarily unavailable. Your rental records are still
          below.
        </p>
      )}
      {entries.length ? (
        <ol className="closet-timeline">
          {entries.map((entry) => {
            const Icon = icons[entry.icon];
            return (
              <li key={entry.id} className={entry.due ? "activity-due" : ""}>
                <span className="activity-marker" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <Link
                  className="activity-entry"
                  href={`/bookings/${entry.bookingId}`}
                >
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.detail}</p>
                    {entry.timestamp ? (
                      <time dateTime={entry.timestamp}>
                        {entry.due ? "Due " : ""}
                        {date(entry.timestamp)}
                      </time>
                    ) : (
                      <small>Current rental state</small>
                    )}
                  </div>
                  <ArrowUpRight size={17} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="activity-empty">
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <p>
            {loading
              ? "Opening your recent activity…"
              : "Your rental stories will appear here as they unfold."}
          </p>
          <Link href="/explore" className="text-link underline">
            Find your next piece <ArrowUpRight size={15} />
          </Link>
        </div>
      )}
    </section>
  );
}
