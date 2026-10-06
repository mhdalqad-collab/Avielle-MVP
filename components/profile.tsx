"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ArrowUpRight, MapPin } from "lucide-react";
import {
  api,
  Button,
  date,
  errorMessage,
  Field,
  Listing,
  Loading,
  Notice,
  RequireAccount,
  Review,
  useAuth,
  User,
  useResource,
} from "./shared";
import { ListingCard } from "./catalogue";

export function ProfilePage() {
  return (
    <RequireAccount>
      <ProfileContent />
    </RequireAccount>
  );
}
function ProfileContent() {
  const auth = useAuth();
  const resource = useResource<{ user?: User; profile?: User }>("/api/profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const user = resource.data?.profile || resource.data?.user;
  if (!user && resource.loading)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  return (
    <div className="page narrow">
      <Link className="back-link" href="/dashboard">
        <ArrowLeft size={16} />
        My wardrobe
      </Link>
      <div className="page-heading">
        <p className="eyebrow">A LITTLE ABOUT YOU</p>
        <h1>
          Your shared <em>profile.</em>
        </h1>
        <p>
          One profile for renting and lending. Your name, area and introduction
          are visible to the community.
        </p>
      </div>
      {resource.error && <Notice>{resource.error}</Notice>}
      {error && <Notice>{error}</Notice>}
      {saved && <Notice kind="success">Your profile is saved.</Notice>}
      {user && (
        <form
          className="panel stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setSaved(false);
            const data = new FormData(e.currentTarget);
            try {
              await api(
                "/api/profile",
                {
                  name: String(data.get("name")),
                  bio: String(data.get("bio")),
                  location: String(data.get("location")),
                },
                "PATCH",
              );
              await auth.refresh();
              await resource.refresh();
              setSaved(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Display name">
            <input
              name="name"
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
              defaultValue={user.name}
            />
          </Field>
          <Field
            label="Your area"
            hint="Use a neighbourhood or city, rather than your exact home address."
          >
            <input
              name="location"
              maxLength={120}
              defaultValue={user.location || ""}
              placeholder="e.g. Chelsea, London"
            />
          </Field>
          <Field label="Introduce yourself">
            <textarea
              name="bio"
              maxLength={1000}
              defaultValue={user.bio || ""}
              rows={5}
              placeholder="A little about your style, your wardrobe or what you love to wear."
            />
          </Field>
          <p className="small muted">
            Your sign-in email is private: {user.email || auth.user?.email}.
            Share collection details only in your booking conversation.
          </p>
          <div className="button-row">
            <Button busy={busy}>Save profile</Button>
            <Link className="button outline" href={`/members/${user.id}`}>
              View public profile <ArrowUpRight size={15} />
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

type PublicProfile = {
  id: string;
  name: string;
  bio: string;
  location: string;
  createdAt: string;
  listings: Listing[];
  reviews: (Review & { author?: { name: string }; authorName?: string })[];
};
export function MemberPage({ id }: { id: string }) {
  const resource = useResource<{ profile: PublicProfile; currency?: string }>(
    `/api/members/${encodeURIComponent(id)}`,
  );
  if (resource.loading && !resource.data)
    return (
      <div className="page">
        <Loading />
      </div>
    );
  if (!resource.data)
    return (
      <div className="page narrow">
        <Notice>{resource.error || "Profile not found."}</Notice>
        <Link className="button outline" href="/explore">
          Explore the wardrobe
        </Link>
      </div>
    );
  const p = resource.data.profile;
  return (
    <div className="page">
      <Link href="/explore" className="back-link">
        <ArrowLeft size={16} />
        The shared wardrobe
      </Link>
      <section className="profile-hero">
        <span className="avatar profile-avatar">{p.name.charAt(0)}</span>
        <div>
          <p className="eyebrow">PART OF THE SHARED WARDROBE</p>
          <h1>{p.name}</h1>
          {p.location && (
            <p className="location">
              <MapPin size={16} />
              {p.location}
            </p>
          )}
          <p className="preserve">
            {p.bio || "A member of the Avielle community."}
          </p>
          <small className="muted">Member since {date(p.createdAt)}</small>
        </div>
      </section>
      <section className="section profile-pieces">
        <div className="section-heading">
          <h2>From their wardrobe.</h2>
          <span>
            {p.listings.length} published{" "}
            {p.listings.length === 1 ? "piece" : "pieces"}
          </span>
        </div>
        {p.listings.length ? (
          <div className="listing-grid">
            {p.listings.map((l) => (
              <ListingCard
                key={l.id}
                listing={l}
                currency={resource.data!.currency || "gbp"}
              />
            ))}
          </div>
        ) : (
          <p className="panel muted">No published pieces at the moment.</p>
        )}
      </section>
      <section>
        <p className="eyebrow">COMPLETED RENTALS</p>
        <h2>Community reviews.</h2>
        {p.reviews.length ? (
          <div className="review-grid">
            {p.reviews.map((r) => (
              <article key={r.id} className="panel">
                <strong>{r.rating} / 5</strong>
                <p className="preserve">{r.comment}</p>
                <small>
                  {r.author?.name || r.authorName || "Avielle member"} ·{" "}
                  {date(r.createdAt)}
                </small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No completed rental reviews yet.</p>
        )}
      </section>
    </div>
  );
}
