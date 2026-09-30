"use client";

import { useState } from "react";
import { offrampAction } from "@/lib/merchant-actions";

interface CashOutProps {
  network: string;
  /** Current balance, prefilled as the amount. */
  balance: string | null;
}

/**
 * Cash out to a bank through an off-ramp partner. SettleKit only opens the
 * partner with your amount, network and wallet prefilled; you send the USDC
 * from your wallet there.
 */
export function CashOut({ network, balance }: CashOutProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance && Number(balance) > 0 ? balance : "");
  const [links, setLinks] = useState<{ provider: string; name: string; url: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        Cash out
      </button>
    );
  }

  async function find(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await offrampAction(network, amount.trim());
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not load cash-out options.");
      return;
    }
    setLinks(result.data.links);
  }

  return (
    <form onSubmit={find} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input className="input" style={{ width: 110 }} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount" required />
      <button type="submit" className="btn btn-small" disabled={busy}>
        {busy ? "..." : "Show options"}
      </button>
      {links !== null && links.length === 0 ? <span className="dim small">No cash-out partner is available for this network yet.</span> : null}
      {links?.map((l) => (
        <a key={l.provider} className="btn btn-small btn-primary" href={l.url} target="_blank" rel="noreferrer">
          {l.name}
        </a>
      ))}
      {error ? <span className="field-error">{error}</span> : null}
    </form>
  );
}
