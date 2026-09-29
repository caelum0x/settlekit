"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { refundPaymentAction, type RefundInput } from "@/lib/merchant-actions";

interface RefundFormProps {
  paymentId: string;
  amountUsd: string;
  asset: string;
  networkName: string;
  buyerWallet: string | null;
}

/**
 * Refund a confirmed payment. SettleKit never holds funds, so the merchant
 * sends the refund from their own wallet and records it here (optionally with
 * the transaction id); access granted by the payment is revoked by default.
 */
export function RefundForm({ paymentId, amountUsd, asset, networkName, buyerWallet }: RefundFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<RefundInput["reason"]>("customer_request");
  const [amount, setAmount] = useState(amountUsd);
  const [txHash, setTxHash] = useState("");
  const [revokeAccess, setRevokeAccess] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <p className="muted">
        Send {asset} back to the buyer on {networkName} from your wallet
        {buyerWallet ? (
          <>
            {" "}
            (buyer wallet <span className="mono">{buyerWallet}</span>)
          </>
        ) : null}
        , then record it here.
      </p>
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
      <div className="field">
        <label htmlFor="r-tx">Refund transaction (optional)</label>
        <input id="r-tx" className="input mono" value={txHash} onChange={(e) => setTxHash(e.target.value)} placeholder="Transaction hash of the refund you sent" />
      </div>
      <label className="checkbox-row">
        <input type="checkbox" checked={revokeAccess} onChange={(e) => setRevokeAccess(e.target.checked)} />
        <span>Revoke the access this payment granted</span>
      </label>
      {error ? <div className="form-message err">{error}</div> : null}
      <div className="builder-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Recording..." : "Record refund"}
        </button>
      </div>
    </form>
  );
}
