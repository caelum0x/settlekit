"use client";

import { useEffect, useState, type FormEvent } from "react";
import { getSession } from "@/lib/auth";

interface Notice {
  ok: boolean;
  text: string;
}

const DISPLAY_NAME_MAX = 120;

/**
 * Profile editor for the signed-in customer. Self-loads the current account via
 * getSession() (same pattern LinkWallet uses) to seed the display name and show
 * the read-only email, then PATCHes /api/account, which forwards the session
 * cookie as bearer to PATCH /v1/auth/account.
 */
export function EditProfile() {
  const [email, setEmail] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let active = true;
    getSession().then((res) => {
      if (!active || !res.ok) return;
      setEmail(res.data.email);
      const current = typeof res.data.displayName === "string" ? res.data.displayName : "";
      setDisplayName(current);
      setName(current);
    });
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const trimmed = name.trim();
      if (trimmed.length < 1) {
        setNotice({ ok: false, text: "Display name is required." });
        return;
      }
      if (trimmed.length > DISPLAY_NAME_MAX) {
        setNotice({ ok: false, text: `Display name must be 1–${DISPLAY_NAME_MAX} characters.` });
        return;
      }

      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { account?: { displayName?: string } }; error?: { message?: string } | string }
        | null;
      if (!res.ok || !body?.data) {
        const msg =
          body && typeof body.error === "object" && body.error?.message
            ? body.error.message
            : typeof body?.error === "string"
              ? body.error
              : "Could not update profile.";
        setNotice({ ok: false, text: msg });
        return;
      }
      const updated = body.data.account?.displayName ?? trimmed;
      setDisplayName(updated);
      setName(updated);
      setNotice({ ok: true, text: "Profile updated." });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : "Could not update profile." });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-fields" onSubmit={onSubmit}>
      <p className="muted">
        Signed in as <span className="mono">{email || "…"}</span>
      </p>
      <label className="auth-field">
        <span className="auth-label">Email</span>
        <input className="entry-input" type="email" value={email} readOnly disabled />
      </label>
      <label className="auth-field">
        <span className="auth-label">Display name</span>
        <input
          className="entry-input"
          type="text"
          value={name}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="Your name"
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </button>
      {displayName ? (
        <p className="muted">
          Current display name: <span className="mono">{displayName}</span>
        </p>
      ) : null}
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </form>
  );
}
