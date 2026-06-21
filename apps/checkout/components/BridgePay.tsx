"use client";

import { useState } from "react";
import { bridgePayAction, type BridgePayActionResult } from "@/app/actions/bridge-pay";

const SOURCE_CHAINS = [
  { value: "Ethereum_Sepolia", label: "Ethereum" },
  { value: "Base_Sepolia", label: "Base" },
  { value: "Arbitrum_Sepolia", label: "Arbitrum" },
] as const;

interface BridgePayProps {
  /** Decimal order amount (session.amount.amount). */
  amount: string;
}

/**
 * "Pay from another chain" — bridges USDC from a source chain to Arc for the
 * order via the offline bridge Server Action, rendering a receipt. Live swap is
 * documented in lib/bridge-pay.ts.
 */
export function BridgePay({ amount }: BridgePayProps) {
  const [fromChain, setFromChain] = useState<(typeof SOURCE_CHAINS)[number]["value"]>(
    "Ethereum_Sepolia",
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<BridgePayActionResult | null>(null);

  async function onBridge() {
    setPending(true);
    setResult(null);
    try {
      setResult(await bridgePayAction({ amount, fromChain }));
    } catch {
      setResult({ ok: false, error: "Bridge failed." });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bridge-pay">
      <p className="hint">Pay from another chain — we bridge USDC to Arc for you.</p>
      <div className="payto-row">
        <span className="label">From</span>
        <select
          className="input"
          value={fromChain}
          onChange={(e) => setFromChain(e.target.value as typeof fromChain)}
        >
          {SOURCE_CHAINS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="btn" onClick={onBridge} disabled={pending}>
        {pending ? "Bridging…" : "Bridge & pay"}
      </button>

      {result?.ok ? (
        <div className="receipt receipt-ok">
          <div className="payto-row">
            <span className="label">Bridged from</span>
            <span>{result.fromChain}</span>
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
