"use client";

import { useState } from "react";
import { sendP2PAction, type P2PActionResult } from "@/app/actions/p2p";

/**
 * P2P "send USDC on Arc" form. Submits to the offline send Server Action and
 * renders a receipt. Mirrors the checkout wallet-pay UX; goes live with a
 * one-line backend swap in lib/p2p.ts.
 */
export function P2PSend() {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<P2PActionResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setResult(null);
    try {
      setResult(await sendP2PAction({ amount, to, chain: "Arc_Testnet" }));
    } catch {
      setResult({ ok: false, error: "Send failed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="p2p-send">
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="p2p-to">Recipient address</label>
          <input
            id="p2p-to"
            className="input"
            value={to}
            placeholder="0x…"
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="p2p-amount">Amount (USDC)</label>
          <input
            id="p2p-amount"
            className="input"
            inputMode="decimal"
            value={amount}
            placeholder="1.00"
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Sending…" : "Send USDC"}
        </button>
      </form>

      {result?.ok ? (
        <div className="form-message ok">
          Sent. Tx <span className="mono">{result.txHash}</span>
          {result.explorerUrl ? (
            <>
              {" · "}
              <a href={result.explorerUrl} target="_blank" rel="noreferrer">
                explorer
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {result && !result.ok ? <div className="form-message err">{result.error}</div> : null}
    </div>
  );
}
