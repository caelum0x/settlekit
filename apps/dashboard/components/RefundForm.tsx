"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refundPaymentAction, type RefundInput } from "@/lib/merchant-actions";
import { sendRefundAction } from "@/lib/billing-actions";
import { WalletRefund } from "@/components/WalletRefund";

/** Whether the SettleKit operator wallet can send this refund (GET /v1/onchain-billing/refunds/route). */
export interface RefundAutomation {
  automated: boolean;
  /** Buyer wallet already known (subscription pull, escrow, bound payer). */
  to: string | null;
  needsRecipient: boolean;
  /** Why it cannot be sent automatically. */
  reason: string | null;
}

interface RefundFormProps {
  paymentId: string;
  /** Payment network id (base, solana, ...). */
  network?: string;
  amountUsd: string;
  asset: string;
  networkName: string;
  buyerWallet: string | null;
  automation: RefundAutomation | null;
}

type Mode = "send" | "wallet" | "manual";

/** Networks where SettleKit prepares the refund transfer for your wallet. */
const WALLET_REFUND_NETWORKS = new Set(["solana", "base", "ethereum", "arbitrum", "robinhood", "hyperevm", "tempo"]);

/**
 * Refund a confirmed payment. When the operator wallet is configured for the
 * payment's network, "Send refund" moves the funds on-chain (Base escrow
 * payments refund through the escrow) and records the transaction. Otherwise
 * the seller sends it from their own wallet and records the hash here
 * ("I refunded manually"). Access granted by the payment is revoked by default.
 */
export function RefundForm({ paymentId, network, amountUsd, asset, networkName, buyerWallet, automation }: RefundFormProps) {
  const router = useRouter();
  const canSend = automation?.automated === true;
  const canWallet = network !== undefined && WALLET_REFUND_NETWORKS.has(network);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(canSend ? "send" : canWallet ? "wallet" : "manual");
  const [reason, setReason] = useState<RefundInput["reason"]>("customer_request");
  const [amount, setAmount] = useState(amountUsd);
  const [txHash, setTxHash] = useState("");
  const [to, setTo] = useState(automation?.to ?? buyerWallet ?? "");
  const [revokeAccess, setRevokeAccess] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ txHash: string; explorerUrl: string | null } | null>(null);

  if (sent) {
    return (
      <div className="form-message ok" role="status">
        Refund sent.{" "}
        {sent.explorerUrl ? (
          <a className="link mono" href={sent.explorerUrl} target="_blank" rel="noreferrer">
            View transaction
          </a>
        ) : (
          <span className="mono">{sent.txHash}</span>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Refund payment
      </button>
    );
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    if (mode === "send") {
      const result = await sendRefundAction({
        paymentId,
        amount: amount.trim(),
        reason,
        revokeAccess,
        ...(to.trim() && to.trim() !== automation?.to ? { to: to.trim() } : {}),
      });
      setPending(false);
      if (result.error || !result.data) {
        setError(result.error ?? "The refund was not sent.");
        return;
      }
      setSent({ txHash: result.data.execution.txHash, explorerUrl: result.data.execution.explorerUrl });
      router.refresh();
      return;
    }
    const result = await refundPaymentAction(paymentId, {
      reason,
      revokeAccess,
      ...(amount.trim() && amount.trim() !== amountUsd ? { amountUsd: amount.trim() } : {}),
      ...(txHash.trim() ? { txHash: txHash.trim() } : {}),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <form className="form refund-form" onSubmit={submit}>
      <div className="refund-mode" role="radiogroup" aria-label="Refund method">
        <label className="checkbox-row">
          <input type="radio" name="refund-mode" checked={mode === "send"} disabled={!canSend} onChange={() => setMode("send")} />
          <span>Send refund on-chain</span>
        </label>
        <label className="checkbox-row">
          <input type="radio" name="refund-mode" checked={mode === "wallet"} disabled={!canWallet} onChange={() => setMode("wallet")} />
          <span>Send from my wallet (verified onchain)</span>
        </label>
        <label className="checkbox-row">
          <input type="radio" name="refund-mode" checked={mode === "manual"} onChange={() => setMode("manual")} />
          <span>I refunded manually</span>
        </label>
      </div>
      {mode === "send" ? (
        <p className="muted">
          SettleKit sends {asset} on {networkName} back to the buyer from the operator wallet and records the transaction.
        </p>
      ) : (
        <p className="muted">
          {canSend ? "" : `${automation?.reason ?? "Automatic refunds are not set up for this network."} `}
          Send {asset} back to the buyer on {networkName} from your wallet
          {buyerWallet ? (
            <>
              {" "}
              (buyer wallet <span className="mono">{buyerWallet}</span>)
            </>
          ) : null}
          , then record the transaction here.
        </p>
      )}
      <div className="form-row">
        <div className="field">
          <label htmlFor="r-amount">Amount (USD)</label>
          <input id="r-amount" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div className="field">
          <label htmlFor="r-reason">Reason</label>
          <select id="r-reason" className="select" value={reason} onChange={(e) => setReason(e.target.value as RefundInput["reason"])}>
            <option value="customer_request">Customer request</option>
            <option value="duplicate">Duplicate payment</option>
            <option value="delivery_failed">Delivery failed</option>
            <option value="fraudulent">Fraudulent</option>
          </select>
        </div>
      </div>
      {mode === "wallet" ? (
        <>
          {!buyerWallet ? (
            <div className="field">
              <label htmlFor="r-to-w">Buyer wallet</label>
              <input id="r-to-w" className="input mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Address to refund" />
            </div>
          ) : null}
          <WalletRefund
            paymentId={paymentId}
            amount={amount}
            reason={reason}
            revokeAccess={revokeAccess}
            to={buyerWallet ? "" : to}
            onDone={() => setOpen(false)}
          />
        </>
      ) : null}
      {mode === "send" && (automation?.needsRecipient || !automation?.to) ? (
        <div className="field">
          <label htmlFor="r-to">Buyer wallet</label>
          <input id="r-to" className="input mono" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Address the refund is sent to" required />
        </div>
      ) : null}
      {mode === "manual" ? (
        <div className="field">
          <label htmlFor="r-tx">Refund transaction</label>
          <input id="r-tx" className="input mono" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="Transaction hash of the refund you sent" />
        </div>
      ) : null}
      <label className="checkbox-row">
        <input type="checkbox" checked={revokeAccess} onChange={(e) => setRevokeAccess(e.target.checked)} />
        <span>Revoke the access this payment granted</span>
      </label>
      {error ? <div className="form-message err">{error}</div> : null}
      {mode === "wallet" ? null : (
      <div className="builder-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? (mode === "send" ? "Sending..." : "Recording...") : mode === "send" ? `Send ${amount || amountUsd} ${asset}` : "Record refund"}
        </button>
      </div>
      )}
    </form>
  );
}
