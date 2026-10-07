"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Check } from "lucide-react";
import { api, Button, date, errorMessage, Notice, useResource } from "./shared";

export type Notification = {
  id: string;
  title: string;
  body: string;
  bookingId?: string | null;
  readAt: string | null;
  createdAt: string;
};
export type NotificationData = {
  notifications: Notification[];
  unreadCount: number;
};
type NotificationResource = {
  data: NotificationData | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};
export function Notifications({
  resource: provided,
}: { resource?: NotificationResource } = {}) {
  const local = useResource<NotificationData>(
    provided ? null : "/api/notifications",
  );
  const resource = provided || local;
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (provided) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void resource.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [resource.refresh, provided]);
  async function read(id?: string) {
    setBusy(id || "all");
    setError("");
    try {
      await api("/api/notifications", id ? { id } : {}, "PATCH");
      await resource.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel notification-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">STAY IN THE LOOP</p>
          <h2>
            <Bell size={22} /> Your updates{" "}
            {resource.data?.unreadCount ? (
              <span className="notification-count">
                {resource.data.unreadCount}
              </span>
            ) : null}
          </h2>
        </div>
        {!!resource.data?.unreadCount && (
          <Button
            className="outline small-button"
            busy={busy === "all"}
            disabled={!!busy}
            onClick={() => void read()}
          >
            Mark all read
          </Button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {resource.error && <Notice>{resource.error}</Notice>}
      <div className="notifications">
        {resource.data?.notifications.length ? (
          resource.data.notifications.map((n) => (
            <article
              key={n.id}
              className={`notification ${n.readAt ? "read" : "unread"}`}
            >
              <div>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <small>{date(n.createdAt)}</small>
                {n.bookingId && (
                  <Link
                    className="text-link underline"
                    href={`/bookings/${n.bookingId}`}
                    onClick={() => {
                      if (!n.readAt) void read(n.id);
                    }}
                  >
                    Open rental
                  </Link>
                )}
              </div>
              {!n.readAt && (
                <button
                  className="icon-button"
                  aria-label={`Mark ${n.title} read`}
                  disabled={!!busy}
                  onClick={() => void read(n.id)}
                >
                  <Check size={18} />
                </button>
              )}
            </article>
          ))
        ) : (
          <p className="muted">
            {resource.loading
              ? "Loading updates…"
              : "No updates yet. Booking activity and new messages appear here."}
          </p>
        )}
      </div>
    </section>
  );
}
