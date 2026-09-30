"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PromoCodeProps {
  sessionId: string;
  labels?: { open: string; label: string; apply: string; applying: string };
}

const EN = { open: "Have a promo code?", label: "Promo code", apply: "Apply", applying: "Applying..." };

/** One optional field: apply a seller promo code to this checkout. */
export function PromoCode({ sessionId, labels = EN }: PromoCodeProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        {labels.open}
      </button>
    );
  }

  async function apply(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/promo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } | string } | null;
      if (!res.ok) {
        const message = typeof body?.error === "string" ? body.error : body?.error?.message;
        throw new Error(message ?? "Could not apply the promo code.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply the promo code.");
      setBusy(false);
    }
  }

  return (
    <form
      className="promo"
      onSubmit={(event) => {
        event.preventDefault();
        void apply();
      }}
    >
      <label htmlFor="promo-code" className="label">
        {labels.label}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          id="promo-code"
          className="input mono"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          maxLength={64}
          required
        />
        <button type="submit" className="btn btn-small" disabled={busy || code.trim().length === 0}>
          {busy ? labels.applying : labels.apply}
        </button>
      </div>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
