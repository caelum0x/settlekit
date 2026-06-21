"use client";

import { useState } from "react";
import { payWithWalletAction, type WalletPayActionResult } from "@/app/actions/wallet-pay";

interface WalletPayProps {
  /** Decimal order amount (e.g. session.amount.amount). */
  amount: string;
  /** Recipient address (session.payToAddress). */
  payToAddress: string;
}

/**
 * "Pay with wallet" option — runs the offline App Kit Arc USDC send via the
 * server action and renders a self-contained receipt. This is a demo/parallel
 * path to the hosted USDC PaymentForm (the synthetic tx hash is not fed into the
 * confirm flow); going live is a one-line swap documented in lib/wallet-pay.ts.
 */
export function WalletPay({ amount, payToAddress }: WalletPayProps) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WalletPayActionResult | null>(null);

  async function onPay() {
    setPending(true);
    setResult(null);
    try {
      const res = await payWithWalletAction({ amount, to: payToAddress, chain: "Arc_Testnet" });
      setResult(res);
    } catch {
      setResult({ ok: false, error: "Wallet payment could not be completed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wallet-pay">
      <p className="hint">Prefer to pay from a connected wallet? Settle the order on Arc in one click.</p>
      <button type="button" className="btn" onClick={onPay} disabled={pending}>
        {pending ? "Paying…" : "Pay with wallet"}
      </button>

      {result?.ok ? (
        <div className="receipt receipt-ok">
          <div className="payto-row">
            <span className="label">Status</span>
            <span className="badge">paid</span>
          </div>
          <div className="payto-row">
            <span className="label">Tx</span>
            <span className="mono">{result.txHash}</span>
          </div>
          {result.explorerUrl ? (
            <a className="explorer-link" href={result.explorerUrl} target="_blank" rel="noreferrer">
              View on explorer
            </a>
          ) : null}
        </div>
      ) : null}
      {result && !result.ok ? <p className="error">{result.error}</p> : null}
    </div>
  );
}
