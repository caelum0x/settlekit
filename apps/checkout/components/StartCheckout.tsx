"use client";

import { useEffect, useState } from "react";

interface StartCheckoutProps {
  slug: string;
  /** Open the checkout automatically on load (off after an error). */
  auto: boolean;
  /** Promo code carried by the link (`?promo=CODE`). */
  promo?: string;
  labels?: { continue: string; opening: string; note: string };
}

const EN = {
  continue: "Continue to payment",
  opening: "Opening secure checkout...",
  note: "Pay in stablecoins on the network you prefer. Access is delivered automatically once the payment is confirmed on-chain.",
};

/**
 * Opens a fresh checkout session for this payment-link visit and moves the
 * buyer to it. Runs in the browser only, so crawlers never create sessions;
 * the form still works without JavaScript.
 */
export function StartCheckout({ slug, auto, promo, labels = EN }: StartCheckoutProps) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(auto);
  const action = `/l/${encodeURIComponent(slug)}/start${promo ? `?promo=${encodeURIComponent(promo)}` : ""}`;

  async function start(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(action, { method: "POST", headers: { accept: "application/json" } });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) throw new Error(body?.error ?? "Could not open checkout");
      window.location.replace(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open checkout");
      setBusy(false);
    }
  }

  useEffect(() => {
    if (auto) void start();
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <form
      method="post"
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {error ? (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? labels.opening : labels.continue}
      </button>
      <p className="muted" style={{ marginTop: 10 }}>
        {labels.note}
      </p>
    </form>
  );
}
