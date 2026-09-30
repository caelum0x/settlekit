"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvitation } from "@/lib/auth";

/**
 * Accept a team invitation: people without an account set a password and are
 * signed in; existing accounts join and sign in as usual.
 */
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await acceptInvitation({
      token,
      ...(password ? { password } : {}),
      ...(name.trim() ? { displayName: name.trim() } : {}),
    });
    if (result.error || !result.data) {
      setPending(false);
      setError(result.error ?? "Could not accept the invitation.");
      return;
    }
    if (result.data.sessionToken) {
      await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionToken: result.data.sessionToken }),
      });
      router.replace("/");
      return;
    }
    router.replace("/login?joined=1");
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="invite-name">Your name (optional)</label>
        <input id="invite-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </div>
      <div className="field">
        <label htmlFor="invite-password">Password</label>
        <input
          id="invite-password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={8}
          placeholder="At least 8 characters (leave empty if you already have an account)"
        />
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Joining..." : "Accept invitation"}
      </button>
    </form>
  );
}
