"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface TaxDetailsProps {
  sessionId: string;
  country: string | null;
  vatId: string | null;
}

/**
 * Billing country (sets the tax rate) and an optional VAT ID for business
 * buyers. Collapsed to one line until the buyer wants to change it.
 */
export function TaxDetails({ sessionId, country, vatId }: TaxDetailsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({ country: country ?? "", vatId: vatId ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <p className="muted" style={{ marginTop: 8 }}>
        Billing country: {country ?? "not set"}
        {vatId ? `, VAT ID ${vatId}` : ""}.{" "}
        <button type="button" className="link-button" style={{ marginTop: 0 }} onClick={() => setOpen(true)}>
          Change
        </button>
      </p>
    );
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/tax`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ country: values.country.trim().toUpperCase(), vatId: values.vatId.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Could not update the billing details.");
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the billing details.");
      setBusy(false);
    }
  }

  return (
    <form
      className="promo"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor="billing-country" className="label">
        Billing country (two letters, e.g. FR)
      </label>
      <input
        id="billing-country"
        className="input mono"
        value={values.country}
        onChange={(event) => setValues({ ...values, country: event.target.value })}
        maxLength={2}
        required
        autoComplete="country"
      />
      <label htmlFor="vat-id" className="label" style={{ marginTop: 8 }}>
        VAT ID (optional, for businesses)
      </label>
      <input
        id="vat-id"
        className="input mono"
        value={values.vatId}
        onChange={(event) => setValues({ ...values, vatId: event.target.value })}
        maxLength={20}
      />
      <button type="submit" className="btn btn-small" style={{ marginTop: 8 }} disabled={busy}>
        {busy ? "Updating..." : "Update total"}
      </button>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
