"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  api,
  Button,
  date,
  errorMessage,
  Field,
  Loading,
  Notice,
  today,
  useResource,
} from "./shared";

type Range = { startDate: string; endDate: string };
export function AvailabilityCalendar({
  availableFrom,
  availableTo,
  blockedDates = [],
  start = "",
  end = "",
  onSelect,
}: {
  availableFrom: string;
  availableTo: string;
  blockedDates?: Range[];
  start?: string;
  end?: string;
  onSelect?: (value: string) => void;
}) {
  const first = availableFrom > today() ? availableFrom : today();
  const [month, setMonth] = useState(() => first.slice(0, 7));
  const [year, monthNumber] = month.split("-").map(Number);
  const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1));
  const cells = Array.from(
    { length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() },
    (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`,
  );
  function move(amount: number) {
    const next = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
    setMonth(next.toISOString().slice(0, 7));
  }
  return (
    <div className="calendar">
      <div className="calendar-heading">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous month"
          onClick={() => move(-1)}
        >
          <ChevronLeft size={18} />
        </button>
        <strong>
          {new Intl.DateTimeFormat("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(firstDay)}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Next month"
          onClick={() => move(1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="calendar-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <small key={day}>{day}</small>
        ))}
        {Array.from({ length: (firstDay.getUTCDay() + 6) % 7 }, (_, i) => (
          <span key={`space-${i}`} />
        ))}
        {cells.map((value) => {
          const unavailable =
            value < first ||
            value > availableTo ||
            blockedDates.some(
              (b) => value >= b.startDate && value <= b.endDate,
            );
          const selected = !!start && value >= start && value <= (end || start);
          return (
            <button
              type="button"
              key={value}
              className={`${unavailable ? "unavailable" : "available"} ${selected ? "selected" : ""}`}
              disabled={unavailable || !onSelect}
              aria-label={`${date(value)}${unavailable ? ", unavailable" : ", available"}`}
              aria-pressed={onSelect ? selected : undefined}
              title={`${date(value)} · ${unavailable ? "Unavailable" : "Available"}`}
              onClick={() => onSelect?.(value)}
            >
              {Number(value.slice(-2))}
            </button>
          );
        })}
      </div>
      <div className="calendar-key">
        <span>
          <i />
          Available
        </span>
        <span>
          <i className="blocked" />
          Unavailable
        </span>
        {onSelect && (
          <span>
            <i className="chosen" />
            Selected
          </span>
        )}
      </div>
      {onSelect && (
        <p className="small muted">
          Choose pickup, then return. You can also enter dates below.
        </p>
      )}
    </div>
  );
}

type Availability = {
  blocks: (Range & { id: string })[];
  blockedDates: Range[];
};
export function ManageAvailability({
  id,
  availableFrom,
  availableTo,
}: {
  id: string;
  availableFrom: string;
  availableTo: string;
}) {
  const resource = useResource<Availability>(
    `/api/listings/${id}/availability`,
  );
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function remove(blockId: string) {
    setBusy(blockId);
    setError("");
    try {
      await api(
        `/api/listings/${id}/availability?blockId=${encodeURIComponent(blockId)}`,
        undefined,
        "DELETE",
      );
      await resource.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel">
      <p className="eyebrow">MAKE ROOM IN YOUR CALENDAR</p>
      <h2>Availability.</h2>
      <p>
        Block dates when you need the piece yourself. Existing bookings remain
        reserved. Changes save immediately.
      </p>
      {error && <Notice>{error}</Notice>}
      {resource.error && <Notice>{resource.error}</Notice>}
      {resource.loading && !resource.data ? (
        <Loading />
      ) : (
        resource.data && (
          <>
            <AvailabilityCalendar
              availableFrom={availableFrom}
              availableTo={availableTo}
              blockedDates={resource.data.blockedDates}
              start={start}
              end={end}
              onSelect={(value) => {
                if (!start || end || value < start) {
                  setStart(value);
                  setEnd("");
                } else setEnd(value);
              }}
            />
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy("add");
                setError("");
                try {
                  await api(`/api/listings/${id}/availability`, {
                    startDate: start,
                    endDate: end,
                  });
                  setStart("");
                  setEnd("");
                  await resource.refresh();
                } catch (err) {
                  setError(errorMessage(err));
                } finally {
                  setBusy("");
                }
              }}
            >
              <div className="form-grid">
                <Field label="Block from">
                  <input
                    type="date"
                    required
                    value={start}
                    min={availableFrom > today() ? availableFrom : today()}
                    max={availableTo}
                    onChange={(e) => {
                      setStart(e.target.value);
                      if (end < e.target.value) setEnd("");
                    }}
                  />
                </Field>
                <Field label="Block until">
                  <input
                    type="date"
                    required
                    value={end}
                    min={start || today()}
                    max={availableTo}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </Field>
              </div>
              <Button
                className="outline"
                busy={busy === "add"}
                disabled={!!busy}
              >
                Block these dates
              </Button>
            </form>
            <ul className="availability-blocks">
              {resource.data.blocks.map((block) => (
                <li key={block.id}>
                  <span>
                    {date(block.startDate)} – {date(block.endDate)}
                  </span>
                  <Button
                    className="outline small-button"
                    busy={busy === block.id}
                    disabled={!!busy}
                    onClick={() => void remove(block.id)}
                  >
                    Remove block
                  </Button>
                </li>
              ))}
            </ul>
            {!resource.data.blocks.length && (
              <p className="small muted">No personal date blocks yet.</p>
            )}
          </>
        )
      )}
    </section>
  );
}
