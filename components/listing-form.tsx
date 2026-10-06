"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Camera, Check, Leaf } from "lucide-react";
import {
  api,
  Button,
  Catalogue,
  categories,
  conditions,
  errorMessage,
  Field,
  Listing,
  Loading,
  Notice,
  PhotoUpload,
  RequireAccount,
  today,
  useAuth,
  useResource,
} from "./shared";

import { ManageAvailability } from "./availability";
export function ListingPage() {
  return (
    <RequireAccount verified>
      <ListingEditor />
    </RequireAccount>
  );
}
function ListingEditor() {
  const auth = useAuth();
  const params = useSearchParams();
  const edit = params.get("edit");
  const resource = useResource<{ listing: Listing }>(
    edit ? `/api/listings/${encodeURIComponent(edit)}` : null,
  );
  if (edit && resource.loading && !resource.data)
    return (
      <div className="page">
        <Loading text="Opening your piece…" />
      </div>
    );
  if (edit && !resource.data)
    return (
      <div className="page narrow">
        <Notice>{resource.error || "Piece not found."}</Notice>
        <Link className="button outline" href="/dashboard">
          My wardrobe
        </Link>
      </div>
    );
  if (
    edit &&
    resource.data &&
    resource.data.listing.ownerId !== auth.user?.id &&
    auth.user?.role !== "ADMIN"
  )
    return (
      <div className="page narrow">
        <Notice>Only the lender can edit this piece.</Notice>
        <Link className="button outline" href="/dashboard">
          My wardrobe
        </Link>
      </div>
    );
  return (
    <ListingForm
      key={edit || "new"}
      initial={edit ? resource.data?.listing : undefined}
    />
  );
}
function ListingForm({ initial }: { initial?: Listing }) {
  const router = useRouter();
  const config = useResource<Catalogue>("/api/listings");
  const [photos, setPhotos] = useState<string[]>(initial?.images || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState(initial?.availableFrom || today());
  const currency = config.data?.currency?.toUpperCase();
  return (
    <div className="page">
      <Link href="/dashboard" className="back-link">
        <ArrowLeft size={16} />
        My wardrobe
      </Link>
      <div className="page-heading">
        <p className="eyebrow">A NEW CHAPTER FOR YOUR FAVOURITES</p>
        <h1>
          {initial ? (
            <>
              A few thoughtful <em>details.</em>
            </>
          ) : (
            <>
              Share something <em>beautiful.</em>
            </>
          )}
        </h1>
        <p>
          {initial
            ? "Updates are reviewed again before publication. Finish or cancel open rentals before changing listing details."
            : "A little detail goes a long way. Help someone find their perfect piece."}
        </p>
        {initial && (
          <a className="text-link underline" href="#availability">
            Manage date blocks ↓
          </a>
        )}
      </div>
      <div className="listing-form-layout">
        <form
          className="listing-form stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            if (!photos.length) {
              setError(
                "Add at least one photo of your piece before submitting.",
              );
              return;
            }
            if (!config.data) {
              setError(
                "We couldn’t load the current currency and fees. Please try again shortly.",
              );
              return;
            }
            const data = new FormData(e.currentTarget);
            const body: Record<string, unknown> = { images: photos };
            for (const key of [
              "title",
              "description",
              "brand",
              "category",
              "size",
              "measurements",
              "condition",
              "location",
              "availableFrom",
              "availableTo",
            ])
              body[key] = String(data.get(key) || "").trim();
            for (const key of ["dailyRate", "cleaningFee", "deposit"])
              body[key] = Math.round(Number(data.get(key)) * 100);
            setBusy(true);
            try {
              await api(
                initial ? `/api/listings/${initial.id}` : "/api/listings",
                initial ? { ...body, action: "update" } : body,
                initial ? "PATCH" : "POST",
              );
              router.push(`/dashboard?${initial ? "updated" : "created"}=1`);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <section className="panel">
            <div className="form-section-title">
              <span>01</span>
              <div>
                <h2>Picture the possibilities.</h2>
                <p>
                  Use your own photos. Show the front, back, label and any signs
                  of wear.
                </p>
              </div>
            </div>
            <PhotoUpload value={photos} onChange={setPhotos} />
            <p className="small muted">
              Your first photo becomes the cover. Avoid personal information in
              the frame.
            </p>
          </section>
          <section className="panel">
            <div className="form-section-title">
              <span>02</span>
              <div>
                <h2>Tell its story.</h2>
                <p>Clear details help renters choose with confidence.</p>
              </div>
            </div>
            <div className="form-grid">
              <Field label="Listing title" className="span-2">
                <input
                  name="title"
                  defaultValue={initial?.title}
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="e.g. Silk slip dress in champagne"
                />
              </Field>
              <Field label="Brand">
                <input
                  name="brand"
                  defaultValue={initial?.brand}
                  required
                  maxLength={100}
                  placeholder="The name on the label"
                />
              </Field>
              <Field label="Category">
                <select
                  name="category"
                  required
                  defaultValue={initial?.category || ""}
                >
                  <option value="" disabled>
                    Choose a category
                  </option>
                  {[
                    ...new Set([
                      ...categories,
                      ...(initial?.category ? [initial.category] : []),
                    ]),
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Label size">
                <input
                  name="size"
                  defaultValue={initial?.size}
                  required
                  maxLength={80}
                  placeholder="e.g. UK 10, EU 38, M"
                />
              </Field>
              <Field label="Condition">
                <select
                  name="condition"
                  required
                  defaultValue={initial?.condition || ""}
                >
                  <option value="" disabled>
                    Choose its condition
                  </option>
                  {[
                    ...new Set([
                      ...conditions,
                      ...(initial?.condition ? [initial.condition] : []),
                    ]),
                  ].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Measurements & fit"
                className="span-2"
                hint="Include the measurement unit and any fit notes."
              >
                <textarea
                  name="measurements"
                  defaultValue={initial?.measurements}
                  rows={3}
                  maxLength={1000}
                  placeholder="e.g. Bust 88 cm, waist 70 cm, length 120 cm. Fits true to size."
                />
              </Field>
              <Field label="Description & care" className="span-2">
                <textarea
                  name="description"
                  defaultValue={initial?.description}
                  required
                  minLength={20}
                  maxLength={5000}
                  rows={5}
                  placeholder="What makes this piece special? Include fabric, fit, care instructions and any flaws or wear."
                />
              </Field>
              <Field
                label="Pickup area"
                className="span-2"
                hint="Use a town or neighbourhood. Share your exact pickup address only in a confirmed booking conversation."
              >
                <input
                  name="location"
                  defaultValue={initial?.location}
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="e.g. Chelsea, London"
                />
              </Field>
            </div>
          </section>
          <section className="panel">
            <div className="form-section-title">
              <span>03</span>
              <div>
                <h2>Make it your own.</h2>
                <p>Set your price, deposit and available dates.</p>
              </div>
            </div>
            {config.error && (
              <Notice>
                {config.error}{" "}
                <button
                  type="button"
                  className="text-link underline"
                  onClick={() => void config.refresh()}
                >
                  Try again
                </button>
              </Notice>
            )}
            <div className="form-grid">
              <Field
                label={`Daily rental price ${currency ? `(${currency})` : ""}`}
              >
                <input
                  type="number"
                  name="dailyRate"
                  defaultValue={initial ? initial.dailyRate / 100 : undefined}
                  required
                  min="0.50"
                  max="10000"
                  step="0.01"
                  placeholder="0.00"
                />
              </Field>
              <Field
                label={`Cleaning fee ${currency ? `(${currency})` : ""}`}
                hint="One fee per rental, including zero."
              >
                <input
                  type="number"
                  name="cleaningFee"
                  required
                  min="0"
                  max="10000"
                  step="0.01"
                  defaultValue={initial ? initial.cleaningFee / 100 : 0}
                />
              </Field>
              <Field
                label={`Refundable deposit ${currency ? `(${currency})` : ""}`}
                className="span-2"
                hint="Charged at checkout and refunded after inspected return, subject to resolved claims."
              >
                <input
                  type="number"
                  name="deposit"
                  required
                  min="0"
                  max="50000"
                  step="0.01"
                  defaultValue={initial ? initial.deposit / 100 : 0}
                />
              </Field>
              <Field label="Available from">
                <input
                  name="availableFrom"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  required
                />
              </Field>
              <Field label="Available until">
                <input
                  name="availableTo"
                  type="date"
                  min={start > today() ? start : today()}
                  defaultValue={initial?.availableTo}
                  required
                />
              </Field>
            </div>
            {config.data && (
              <p className="fee-note">
                Avielle’s lender commission is {config.data.commissionBps / 100}
                % of the rental price. Cleaning fees are listed separately. Your
                earnings are shown on each booking before acceptance.
              </p>
            )}
          </section>
          <label className="checkbox">
            <input type="checkbox" required />
            <span>
              I own this piece or have permission to lend it. My photos and
              description accurately show its condition, and I agree to the{" "}
              <a
                target="_blank"
                rel="noreferrer"
                href={process.env.NEXT_PUBLIC_TERMS_URL || "/terms"}
              >
                rental terms
              </a>
              .
            </span>
          </label>
          {error && <Notice>{error}</Notice>}
          <Button busy={busy} disabled={!config.data} className="full">
            {initial ? "Save & submit for review" : "Submit for review"}{" "}
            <ArrowRight size={17} />
          </Button>
          <p className="small center muted">
            Your piece will be visible after a review by the Avielle team.
          </p>
        </form>
        <aside className="listing-advice">
          <div className="advice-card">
            <Camera size={28} strokeWidth={1.3} />
            <h3>A little light. A lot of detail.</h3>
            <p>
              Natural light and a simple background help your piece shine.
              Include close-ups of details and signs of wear.
            </p>
            <ul>
              <li>
                <Check size={14} /> Front and back
              </li>
              <li>
                <Check size={14} /> Brand and size labels
              </li>
              <li>
                <Check size={14} /> Fabric and special details
              </li>
              <li>
                <Check size={14} /> Any marks or imperfections
              </li>
            </ul>
          </div>
          <div className="advice-card green">
            <Leaf size={26} strokeWidth={1.3} />
            <h3>Good things deserve another outing.</h3>
            <p>
              Thoughtful listings make a more considerate community. Start with
              a piece you’d be excited to discover yourself.
            </p>
          </div>
        </aside>
      </div>
      {initial && (
        <div id="availability" className="availability-manager">
          <ManageAvailability
            id={initial.id}
            availableFrom={initial.availableFrom}
            availableTo={initial.availableTo}
          />
        </div>
      )}
    </div>
  );
}
