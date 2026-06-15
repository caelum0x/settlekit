"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  completeMagicLink,
  login,
  register,
  requestMagicLink,
  type AuthSession,
} from "@/lib/auth";

type Mode = "login" | "signup";
type Method = "password" | "magic";

interface AuthFormProps {
  mode: Mode;
}

interface Notice {
  ok: boolean;
  text: string;
}

/**
 * Persist the session token in the httpOnly cookie via the session route
 * handler. Throws on failure so the caller can surface an error instead of
 * redirecting into an unauthenticated state.
 */
async function persistSession(sessionToken: string): Promise<void> {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    throw new Error("Could not establish session. Please try again.");
  }
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [magicToken, setMagicToken] = useState("");
  const [devTokenSent, setDevTokenSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const isSignup = mode === "signup";

  /** On a successful auth call: persist the cookie and go to the dashboard. */
  async function completeAuth(session: AuthSession) {
    await persistSession(session.sessionToken);
    router.push("/");
    router.refresh();
  }

  async function onPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = isSignup
        ? await register({
            email,
            password,
            type: "merchant",
            displayName: displayName || undefined,
            organizationId: organizationId || undefined,
          })
        : await login({ email, password });

      if (result.error || !result.data) {
        setNotice({ ok: false, text: result.error ?? "Authentication failed." });
        return;
      }
      await completeAuth(result.data);
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setPending(false);
    }
  }

  async function onMagicRequest(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await requestMagicLink(email);
      if (result.error || !result.data) {
        setNotice({ ok: false, text: result.error ?? "Could not send link." });
        return;
      }
      setDevTokenSent(true);
      if (result.data.devToken) {
        setMagicToken(result.data.devToken);
        setNotice({
          ok: true,
          text: "Dev token filled in below — submit to continue.",
        });
      } else {
        setNotice({
          ok: true,
          text: `Check ${email} for a sign-in link, then paste the token below.`,
        });
      }
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setPending(false);
    }
  }

  async function onMagicComplete(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const result = await completeMagicLink(magicToken.trim());
      if (result.error || !result.data) {
        setNotice({ ok: false, text: result.error ?? "Invalid or expired token." });
        return;
      }
      await completeAuth(result.data);
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : "Request failed.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth-card">
      <div className="auth-method-toggle" role="tablist" aria-label="Sign-in method">
        <button
          type="button"
          role="tab"
          aria-selected={method === "password"}
          className={method === "password" ? "btn btn-primary" : "btn"}
          onClick={() => {
            setMethod("password");
            setNotice(null);
          }}
        >
          Password
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "magic"}
          className={method === "magic" ? "btn btn-primary" : "btn"}
          onClick={() => {
            setMethod("magic");
            setNotice(null);
          }}
        >
          Magic link
        </button>
      </div>

      {method === "password" ? (
        <form className="form" onSubmit={onPasswordSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              placeholder="you@company.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              placeholder="••••••••"
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {isSignup ? (
            <>
              <div className="field">
                <label htmlFor="displayName">Display name (optional)</label>
                <input
                  id="displayName"
                  className="input"
                  type="text"
                  value={displayName}
                  placeholder="Acme Inc."
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="organizationId">Organization ID (optional)</label>
                <input
                  id="organizationId"
                  className="input"
                  type="text"
                  value={organizationId}
                  placeholder="org_…"
                  onChange={(e) => setOrganizationId(e.target.value)}
                />
                <span className="field-hint">
                  Leave blank to create a new organization.
                </span>
              </div>
            </>
          ) : null}

          {notice ? (
            <div className={`form-message ${notice.ok ? "ok" : "err"}`}>
              {notice.text}
            </div>
          ) : null}

          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending
              ? "Working…"
              : isSignup
                ? "Create merchant account"
                : "Sign in"}
          </button>
        </form>
      ) : (
        <div className="form">
          <form className="form" onSubmit={onMagicRequest}>
            <div className="field">
              <label htmlFor="magic-email">Email</label>
              <input
                id="magic-email"
                className="input"
                type="email"
                autoComplete="email"
                required
                value={email}
                placeholder="you@company.com"
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={pending}>
              {pending ? "Sending…" : "Send magic link"}
            </button>
          </form>

          {devTokenSent ? (
            <form className="form" onSubmit={onMagicComplete}>
              <div className="field">
                <label htmlFor="magic-token">Sign-in token</label>
                <input
                  id="magic-token"
                  className="input"
                  type="text"
                  required
                  value={magicToken}
                  placeholder="Paste the token from your email"
                  onChange={(e) => setMagicToken(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" type="submit" disabled={pending}>
                {pending ? "Verifying…" : "Continue"}
              </button>
            </form>
          ) : null}

          {notice ? (
            <div className={`form-message ${notice.ok ? "ok" : "err"}`}>
              {notice.text}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
