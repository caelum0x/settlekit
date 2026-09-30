"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RefundPlan } from "@/lib/merchant-api";
import { cancelRefundAction, confirmRefundAction, prepareRefundAction, type RefundInput } from "@/lib/merchant-actions";

interface WalletRefundProps {
  paymentId: string;
  amount: string;
  reason: RefundInput["reason"];
  revokeAccess: boolean;
  /** Buyer wallet override (when SettleKit does not know it). */
  to: string;
  onDone: () => void;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function injected(): Eip1193 | null {
  const w = window as unknown as { ethereum?: Eip1193 };
  return w.ethereum ?? null;
}

const RETRY_MS = 5_000;
const MAX_TRIES = 24;

/**
 * Refund from the merchant's own wallet: SettleKit prepares the exact
 * transfer to the buyer, the merchant signs it (browser wallet or a mobile
 * wallet link), and the refund is recorded only after SettleKit verifies it
 * onchain.
 */
export function WalletRefund({ paymentId, amount, reason, revokeAccess, to, onDone }: WalletRefundProps) {
  const router = useRouter();
  const [refundId, setRefundId] = useState<string | null>(null);
  const [plan, setPlan] = useState<RefundPlan | null>(null);
  const [txHash, setTxHash] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await prepareRefundAction(paymentId, {
      reason,
      ...(amount.trim() ? { amountUsd: amount.trim() } : {}),
      ...(to.trim() ? { to: to.trim() } : {}),
    });
    setBusy(false);
    if (result.error || !result.data) {
      setError(result.error ?? "Could not prepare the refund.");
      return;
    }
    setRefundId(result.data.refund.id);
    setPlan(result.data.plan);
  }

  async function confirm(hash: string): Promise<void> {
    if (!refundId) return;
    setBusy(true);
    setError(null);
    for (let attempt = 0; attempt < MAX_TRIES; attempt += 1) {
      setStatus(attempt === 0 ? "Checking the transaction onchain..." : "Waiting for confirmations...");
      const result = await confirmRefundAction(refundId, { txHash: hash, revokeAccess });
      if (!result.error) {
        setBusy(false);
        setStatus("Refund verified onchain and recorded.");
        router.refresh();
        onDone();
        return;
      }
      if (!/not yet verifiable|retry later/i.test(result.error)) {
        setBusy(false);
        setStatus(null);
        setError(result.error);
        return;
      }
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
    setBusy(false);
    setStatus(null);
    setError("The transaction is not final yet. Paste the hash again in a minute.");
  }

  async function sendWithBrowserWallet(): Promise<void> {
    const wallet = injected();
    if (!plan?.evm || !wallet) {
      setError("No browser wallet found. Use the wallet link, then paste the transaction hash.");
      return;
    }
    try {
      setError(null);
      const accounts = (await wallet.request({ method: "eth_requestAccounts" })) as string[];
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${plan.evm.chainId.toString(16)}` }] });
      const hash = (await wallet.request({
        method: "eth_sendTransaction",
        params: [{ from: accounts[0], to: plan.evm.token, data: plan.evm.data, value: "0x0" }],
      })) as string;
      setTxHash(hash);
      await confirm(hash);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet did not send the transaction.");
    }
  }

  async function cancel(): Promise<void> {
    if (refundId) await cancelRefundAction(refundId);
    onDone();
  }

  if (!plan) {
    return (
      <div>
        {error ? <div className="form-message err">{error}</div> : null}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void prepare()}>
          {busy ? "Preparing..." : "Prepare refund"}
        </button>
      </div>
    );
  }

  return (
    <div className="refund-wallet">
      <p className="muted">
        Send exactly {plan.amount} {plan.asset} to <span className="mono">{plan.to}</span> on {plan.network}.
      </p>
      {plan.evm ? (
        <p>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void sendWithBrowserWallet()}>
            Send with browser wallet
          </button>{" "}
          <a className="link" href={plan.evm.eip681}>
            Open in mobile wallet
          </a>
        </p>
      ) : null}
      {plan.solana ? (
        <p>
          <a className="btn btn-primary" href={plan.solana.url}>
            Open in Solana wallet
          </a>
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="wr-tx">Transaction hash</label>
        <input id="wr-tx" className="input mono" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="Paste it here if you sent from another wallet" />
      </div>
      {status ? <div className="form-message ok">{status}</div> : null}
      {error ? <div className="form-message err">{error}</div> : null}
      <div className="builder-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void cancel()}>
          Cancel refund
        </button>
        <button type="button" className="btn" disabled={busy || txHash.trim().length === 0} onClick={() => void confirm(txHash.trim())}>
          Verify and record
        </button>
      </div>
    </div>
  );
}
