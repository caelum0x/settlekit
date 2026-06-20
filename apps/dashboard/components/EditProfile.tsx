"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EditProfileProps {
  /** The account email (read-only; shown for context). */
  email: string;
  /** The current display name, if the account has one. */
  displayName?: string;
}

interface Notice {
  ok: boolean;
  text: string;
}

/**
 * Profile editor for an already-signed-in account. Edits the display name and
 * PATCHes it to the local /api/account route, which forwards the session cookie
 * as the bearer to PATCH /v1/auth/account. Email is read-only.
 */
export function EditProfile({ email, displayName }: EditProfileProps) {
  const router = useRouter();
  const [name, setName] = useState<string>(displayName ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    try {
      const trimmed = name.trim();
      if (trimmed.length < 1) {
        setNotice({ ok: false, text: "Display name is required." });
        return;
      }

      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { account?: { displayName?: string } }; error?: string }
        | null;
      if (!res.ok || !body?.data) {
        setNotice({ ok: false, text: body?.error ?? "Could not update profile." });
        return;
      }

      setName(body.data.account?.displayName ?? trimmed);
      setNotice({ ok: true, text: "Profile updated." });
      router.refresh();
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
    <form className="wallet-link" onSubmit={onSubmit}>
      <dl className="detail-grid" style={{ marginBottom: 18 }}>
        <dt>Email</dt>
        <dd className="mono">{email}</dd>
        <dt>Display name</dt>
        <dd>{displayName ?? "Not set"}</dd>
      </dl>
      <div className="field">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          placeholder="Your name"
          disabled={pending}
        />
        <p className="field-hint">Shown on receipts and in the dashboard.</p>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </button>
      </div>
      {notice ? (
        <div className={`form-message ${notice.ok ? "ok" : "err"}`}>{notice.text}</div>
      ) : null}
    </form>
  );
}
