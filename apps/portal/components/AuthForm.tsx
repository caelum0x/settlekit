"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  completeMagicLink,
  customerIdFromAccount,
  login,
  register,
  requestMagicLink,
  type AuthResult,
  type Account,
} from "@/lib/auth";

type Mode = "login" | "signup";
type Method = "password" | "magic-link";

interface AuthFormProps {
  mode: Mode;
}

/**
 * Real customer sign-in / sign-up form. Supports a password method and a
 * magic-link method. On success it persists the session cookie (via lib/auth,
 * which calls the /api/session route handler) and redirects to the customer's
 * portal at /c/[customerId], where the customer id is the authenticated
 * account id.
 */
export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();

  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  // Magic-link state: once a link is requested we collect the token to complete.
  const [magicToken, setMagicToken] = useState("");
  const [magicRequested, setMagicRequested] = useState(false);
  const [devToken, setDevToken] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onAuthenticated(result: AuthResult<Account>): boolean {
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    const customerId = customerIdFromAccount(result.data);
    router.replace(`/c/${encodeURIComponent(customerId)}`);
    return true;
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email address.");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === "signup"
          ? await register({
              email: trimmedEmail,
              password,
              ...(displayName.trim()
                ? { displayName: displayName.trim() }
                : {}),
            })
          : await login({ email: trimmedEmail, password });
      onAuthenticated(result);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicRequest(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError("Enter your email address.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestMagicLink(trimmedEmail);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMagicRequested(true);
      if (result.data.devToken) {
        setDevToken(result.data.devToken);
        setMagicToken(result.data.devToken);
        setNotice(
          "Email transport is not configured. Use the development token below to continue.",
        );
      } else {
        setNotice(
          "Check your inbox for a sign-in link, then paste the token from it below.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMagicComplete(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const token = magicToken.trim();
    if (!token) {
      setError("Enter the token from your sign-in link.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await completeMagicLink(token);
      onAuthenticated(result);
    } finally {
      setSubmitting(false);
    }
  }

  function switchMethod(next: Method) {
    setMethod(next);
    setError(null);
    setNotice(null);
  }

  const verb = mode === "signup" ? "Create account" : "Sign in";

  return (
    <div className="auth-form">
      <div className="auth-tabs" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={method === "password"}
          className={`auth-tab ${method === "password" ? "is-active" : ""}`}
          onClick={() => switchMethod("password")}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "magic-link"}
          className={`auth-tab ${method === "magic-link" ? "is-active" : ""}`}
          onClick={() => switchMethod("magic-link")}
        >
          Magic link
        </button>
      </div>

      {method === "password" ? (
        <form className="auth-fields" onSubmit={handlePasswordSubmit}>
          {mode === "signup" ? (
            <label className="auth-field">
              <span className="auth-label">Name (optional)</span>
              <input
                className="entry-input"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </label>
          ) : null}

          <label className="auth-field">
            <span className="auth-label">Email</span>
            <input
              className="entry-input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              className="entry-input"
              type="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting ? "Working…" : verb}
          </button>
        </form>
      ) : (
        <div className="auth-fields">
          <form onSubmit={handleMagicRequest} className="auth-fields">
            <label className="auth-field">
              <span className="auth-label">Email</span>
              <input
                className="entry-input"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button
              type="submit"
              className="btn btn-secondary"
              disabled={submitting}
            >
              {submitting && !magicRequested
                ? "Sending…"
                : magicRequested
                  ? "Resend link"
                  : "Email me a sign-in link"}
            </button>
          </form>

          {magicRequested ? (
            <form onSubmit={handleMagicComplete} className="auth-fields">
              <label className="auth-field">
                <span className="auth-label">Sign-in token</span>
                <input
                  className="entry-input"
                  type="text"
                  autoComplete="one-time-code"
                  value={magicToken}
                  onChange={(e) => setMagicToken(e.target.value)}
                  placeholder="Paste the token from your email"
                />
              </label>
              {devToken ? (
                <p className="auth-dev-token mono">{devToken}</p>
              ) : null}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {submitting ? "Verifying…" : "Continue"}
              </button>
            </form>
          ) : null}
        </div>
      )}

      {error ? <p className="entry-error">{error}</p> : null}
      {notice ? <p className="auth-notice">{notice}</p> : null}
    </div>
  );
}
