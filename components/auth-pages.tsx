"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  Button,
  errorMessage,
  Field,
  internalNext,
  Notice,
  useAuth,
} from "./shared";

export function AuthPage({ path }: { path: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [complete, setComplete] = useState(false);
  const action =
    path === "/register"
      ? "register"
      : path === "/forgot-password"
        ? "forgot"
        : path === "/reset-password"
          ? "reset"
          : path === "/verify-email"
            ? "verify"
            : "login";
  const title = {
    register: "Make room for more.",
    login: "Welcome back.",
    forgot: "A fresh start.",
    reset: "Your new password.",
    verify: "Make it official.",
  }[action];
  const subtitle = {
    register: "One account. A whole community of wardrobes.",
    login: "Your next great outfit is waiting.",
    forgot: "Enter your email and we’ll send a password reset link.",
    reset: "Choose a strong password you haven’t used elsewhere.",
    verify: "Confirm your email to begin renting and sharing.",
  }[action];
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <Link href="/" className="auth-back">
          <ArrowLeft size={16} /> Back to Avielle
        </Link>
        <div>
          <p className="eyebrow">LESS OWNING. MORE POSSIBILITIES.</p>
          <h2>
            A wardrobe
            <br />
            worth <em>sharing.</em>
          </h2>
          <p>
            For the pieces you love.
            <br />
            And the moments still to come.
          </p>
        </div>
        <span className="auth-monogram" aria-hidden="true">
          a
        </span>
        <p className="small">Wear. Share. Repeat.</p>
      </aside>
      <section className="auth-form-wrap">
        <div className="auth-form">
          <p className="eyebrow">
            {action === "login" ? "YOUR AVIELLE" : "THE NEXT CHAPTER"}
          </p>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {error && <Notice>{error}</Notice>}
          {message && <Notice kind="success">{message}</Notice>}
          {complete ? (
            <div className="auth-complete">
              <ShieldCheck size={36} strokeWidth={1.2} />
              <Link
                className="button full"
                href={action === "reset" ? "/login" : "/dashboard"}
              >
                {action === "reset"
                  ? "Sign in with your new password"
                  : "Open my wardrobe"}
                <ArrowRight size={17} />
              </Link>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setMessage("");
                setBusy(true);
                const data = new FormData(e.currentTarget);
                const body: Record<string, string> = { action };
                for (const key of ["email", "password", "name"])
                  if (data.get(key)) body[key] = String(data.get(key));
                if (action === "reset" || action === "verify")
                  body.token = params.get("token") || "";
                try {
                  await api("/api/auth", body);
                  if (action === "login") {
                    await auth.refresh();
                    router.replace(internalNext(params.get("next")));
                  } else if (action === "register") {
                    await auth.refresh();
                    setMessage(
                      "Your account is created. Check your inbox for the verification link before renting or listing.",
                    );
                    setComplete(true);
                  } else if (action === "forgot")
                    setMessage(
                      "If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.",
                    );
                  else if (action === "verify") {
                    await auth.refresh();
                    setMessage(
                      "Your email is verified. You’re ready for your next chapter.",
                    );
                    setComplete(true);
                  } else {
                    setMessage(
                      "Your password has been updated. Sign in again to continue.",
                    );
                    setComplete(true);
                  }
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="stack"
            >
              {action === "register" && (
                <Field label="Your name">
                  <input
                    name="name"
                    required
                    autoComplete="name"
                    minLength={2}
                    maxLength={80}
                    placeholder="How should we call you?"
                  />
                </Field>
              )}
              {["register", "login", "forgot"].includes(action) && (
                <Field label="Email address">
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@example.com"
                  />
                </Field>
              )}
              {["register", "login", "reset"].includes(action) && (
                <Field
                  label={action === "reset" ? "New password" : "Password"}
                  hint={
                    action === "login"
                      ? undefined
                      : "At least 12 characters. A memorable phrase works well."
                  }
                >
                  <div className="password-input">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={
                        action === "login" ? "current-password" : "new-password"
                      }
                      required
                      minLength={action === "login" ? 1 : 12}
                      maxLength={128}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </Field>
              )}
              {action === "login" && (
                <Link className="text-link forgot-link" href="/forgot-password">
                  Forgot your password?
                </Link>
              )}
              {action === "register" && (
                <label className="checkbox">
                  <input type="checkbox" required />
                  <span>
                    I’ve read the{" "}
                    <a
                      href={process.env.NEXT_PUBLIC_TERMS_URL || "/terms"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      rental terms
                    </a>{" "}
                    and{" "}
                    <a
                      href={process.env.NEXT_PUBLIC_PRIVACY_URL || "/privacy"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      privacy information
                    </a>
                    .
                  </span>
                </label>
              )}
              {["verify", "reset"].includes(action) && !params.get("token") ? (
                <Notice>
                  This link is missing its security token.{" "}
                  {action === "reset" ? (
                    <Link href="/forgot-password">
                      Request a new reset link.
                    </Link>
                  ) : (
                    <Link href="/dashboard">
                      Open your account to request a new verification email.
                    </Link>
                  )}
                </Notice>
              ) : (
                <Button className="full" busy={busy}>
                  {action === "register"
                    ? "Create my account"
                    : action === "login"
                      ? "Sign in"
                      : action === "forgot"
                        ? "Send reset link"
                        : action === "verify"
                          ? "Confirm my email"
                          : "Save new password"}
                  {action === "forgot" ? (
                    <Mail size={17} />
                  ) : (
                    <ArrowRight size={17} />
                  )}
                </Button>
              )}
            </form>
          )}
          {action === "login" && (
            <p className="auth-switch">
              New to Avielle?{" "}
              <Link
                href={`/register${params.get("next") ? `?next=${encodeURIComponent(internalNext(params.get("next")))}` : ""}`}
              >
                Join the community
              </Link>
            </p>
          )}
          {action === "register" && (
            <p className="auth-switch">
              Already part of the community? <Link href="/login">Sign in</Link>
            </p>
          )}
          {["forgot", "reset", "verify"].includes(action) && (
            <p className="auth-switch">
              <Link href="/login">Back to sign in</Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
