"use client";

import Link from "next/link";
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  AlertCircle,
  Check,
  LoaderCircle,
  Shirt,
  Upload,
  X,
} from "lucide-react";

export type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerifiedAt: string | null;
  payoutsEnabled: boolean;
  active?: boolean;
  bio?: string;
  location?: string;
  createdAt?: string;
};
export type Listing = {
  id: string;
  ownerId: string;
  owner: { id: string; name: string };
  title: string;
  description: string;
  brand: string;
  category: string;
  size: string;
  measurements: string;
  condition: string;
  location: string;
  dailyRate: number;
  cleaningFee: number;
  deposit: number;
  images: string[];
  availableFrom: string;
  availableTo: string;
  status: string;
  moderationNote?: string;
  reviews?: Review[];
  blockedDates?: { startDate: string; endDate: string }[];
};
export type Review = {
  id: string;
  authorId: string;
  rating: number;
  comment: string;
  createdAt: string;
};
export type Evidence = {
  id: string;
  authorId: string;
  phase: string;
  photos: string[];
  notes: string;
  createdAt: string;
};
export type Booking = {
  id: string;
  listing: Listing;
  renterId: string;
  renter: { id: string; name: string };
  startDate: string;
  endDate: string;
  days: number;
  rental: number;
  cleaningFee: number;
  serviceFee: number;
  deposit: number;
  total: number;
  ownerEarnings: number;
  currency: string;
  status: string;
  paymentStatus: string;
  payoutStatus: string;
  refundedAmount: number;
  expiresAt: string | null;
  createdAt: string;
  messages?: {
    id: string;
    senderId: string;
    text: string;
    createdAt: string;
  }[];
  evidence?: Evidence[];
  claim?: {
    id: string;
    kind?: "DAMAGE" | "NOT_RETURNED";
    status: string;
    description: string;
    requestedAmount: number;
    awardedAmount: number;
    resolution: string;
  } | null;
  reviews?: Review[];
  events?: { id: string; type: string; detail: string; createdAt: string }[];
};
export type Catalogue = {
  listings: Listing[];
  currency: string;
  commissionBps: number;
  renterFeeBps: number;
  paymentsReady: boolean;
};
export const categories = [
  "Dresses",
  "Bags",
  "Tops",
  "Bottoms",
  "Outerwear",
  "Shoes",
  "Accessories",
  "Other",
];
export const conditions = ["New with tags", "Like new", "Excellent", "Good"];

export async function api<T>(
  url: string,
  body?: unknown,
  method?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
          data.message ||
          "We couldn’t complete that request. Please try again.",
    );
  return data as T;
}
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api<T>(url);
      if (request === sequence.current) setData(result);
    } catch (e) {
      if (request === sequence.current) setError(errorMessage(e));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [url]);
  useEffect(() => {
    setData(null);
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  return { data, loading, error, refresh };
}
export function errorMessage(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Something went wrong. Please try again.";
}
export function money(value: number, currency = "gbp") {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: 2,
  }).format(value / 100);
}
export function date(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}
export function today() {
  return new Date().toISOString().slice(0, 10);
}
export function label(value: string) {
  return value.toLowerCase().replaceAll("_", " ");
}
export function internalNext(value: string | null) {
  return value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/dashboard";
}

const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}>({ user: null, loading: true, error: "", refresh: async () => {} });
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const resource = useResource<{ user: User | null }>("/api/auth");
  return (
    <AuthContext.Provider
      value={{
        user: resource.data?.user || null,
        loading: resource.loading,
        error: resource.error,
        refresh: resource.refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}

export function Button({
  busy,
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`button ${className}`}
      aria-busy={busy || undefined}
    >
      {busy ? <LoaderCircle size={17} className="spin" /> : null}
      {children}
    </button>
  );
}
export function Notice({
  children,
  kind = "error",
}: {
  children: React.ReactNode;
  kind?: "error" | "success" | "info";
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {kind === "success" ? <Check size={18} /> : <AlertCircle size={18} />}
      <div>{children}</div>
    </div>
  );
}
export function Loading({ text = "Loading…" }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={22} className="spin" />
      {text}
    </div>
  );
}
export function Empty({
  title,
  children,
  href,
  action,
}: {
  title: string;
  children: React.ReactNode;
  href?: string;
  action?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Shirt size={29} strokeWidth={1.3} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {href && (
        <Link className="button" href={href}>
          {action}
          <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {label(value)}
    </span>
  );
}
export function Field({
  label: text,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  const control =
    isValidElement<React.HTMLAttributes<HTMLElement>>(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type)
      ? cloneElement(children, { "aria-label": text })
      : children;
  return (
    <label className={`field ${className}`}>
      <span>{text}</span>
      {control}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}
export function RequireAccount({
  children,
  verified = false,
}: {
  children: React.ReactNode;
  verified?: boolean;
}) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  if (auth.loading && !auth.user)
    return <Loading text="Opening your account…" />;
  if (auth.error)
    return (
      <div className="page narrow">
        <Notice>{auth.error}</Notice>
        <Button onClick={() => void auth.refresh()}>Try again</Button>
      </div>
    );
  if (!auth.user)
    return (
      <div className="page">
        <Empty title="Your wardrobe starts here" href="/login" action="Sign in">
          Sign in to manage your listings, rental requests and conversations.
        </Empty>
      </div>
    );
  if (verified && !auth.user.emailVerifiedAt)
    return (
      <div className="page narrow">
        <p className="eyebrow">One small step</p>
        <h1>Verify your email</h1>
        <p>
          Open the link we sent to {auth.user.email} to start renting and
          listing.
        </p>
        {error && <Notice>{error}</Notice>}
        {message && <Notice kind="success">{message}</Notice>}
        <div className="button-row">
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/api/auth", { action: "resend" });
                setMessage(
                  "A new verification link has been requested. Check your inbox and spam folder.",
                );
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Resend email
          </Button>
          <Button className="outline" onClick={() => void auth.refresh()}>
            I’ve verified my email
          </Button>
        </div>
      </div>
    );
  return <>{children}</>;
}
export function PhotoUpload({
  value,
  onChange,
  purpose = "LISTING",
  bookingId,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  purpose?: "LISTING" | "EVIDENCE";
  bookingId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="upload">
      <div className="photo-grid">
        {value.map((url, i) => (
          <div className="photo-preview" key={url}>
            <img
              src={url}
              alt={`${purpose === "LISTING" ? "Listing" : "Condition"} photo ${i + 1}`}
            />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              disabled={busy}
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      {value.length < 6 && (
        <label className={`upload-zone ${busy ? "disabled" : ""}`}>
          <Upload size={23} />
          <strong>{busy ? "Uploading your photos…" : "Add your photos"}</strong>
          <span>
            JPEG, PNG or WebP · up to 5 MB each · {6 - value.length} remaining
          </span>
          <input
            type="file"
            aria-label="Upload photos"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (!files.length) return;
              setError("");
              if (files.length + value.length > 6) {
                setError("Please select up to six photos in total.");
                return;
              }
              if (files.some((f) => f.size > 5 * 1024 * 1024)) {
                setError("Each photo must be 5 MB or smaller.");
                return;
              }
              setBusy(true);
              const urls = [...value];
              try {
                for (const file of files) {
                  const body = new FormData();
                  body.append("file", file);
                  body.append("purpose", purpose);
                  if (bookingId) body.append("bookingId", bookingId);
                  const result = await api<{ url: string }>(
                    "/api/uploads",
                    body,
                  );
                  urls.push(result.url);
                  onChange([...urls]);
                }
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}
