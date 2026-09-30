import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getReceipt, ApiClientError } from "@/lib/api";
import {
  formatTimestamp,
  truncateMiddle,
} from "@/lib/format";
import { OrderSummary } from "@/components/OrderSummary";
import { AccessList } from "@/components/AccessList";
import { EmbedSuccess } from "@/components/EmbedSuccess";
import { embedOriginsForSession } from "@/lib/embed";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { sessionId: string };
}

/**
 * Success / access page. Fetches the receipt + delivered entitlements from the
 * SettleKit API and renders the order receipt and every delivered access
 * artifact (github invite, license key, download link, discord role, api key).
 */
export default async function SuccessPage({ params }: PageProps) {
  const { sessionId } = params;

  let receipt;
  try {
    receipt = await getReceipt(sessionId);
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.notFound) notFound();
      // Not paid yet → send the buyer back to pay.
      if (error.status === 409) redirect(`/c/${sessionId}`);
    }
    throw error;
  }

  const embedOrigins = await embedOriginsForSession(sessionId).catch(() => []);
  // The receipt amount is the authoritative settled total.
  const total = receipt.amount;
  const INTERNAL_FIELDS = new Set(["subscribeIntentId", "onchainSubscriptionId", "periodIndex"]);
  const buyerEntries = Object.entries(receipt.buyer).filter(([key]) => !INTERNAL_FIELDS.has(key));

  return (
    <div>
      <EmbedSuccess sessionId={sessionId} paymentId={receipt.paymentId} allowedOrigins={embedOrigins} />
      <div className="card center">
        <div className="big-status">Payment confirmed</div>
        <p className="muted">
          {receipt.access.some((item) => item.pending)
            ? "Your USDC payment settled. Some access is still pending; details below."
            : "Your USDC payment settled and access has been delivered."}
        </p>
      </div>

      <div className="card">
        <h2>Receipt</h2>
        <OrderSummary lines={receipt.lines} total={total} discount={receipt.discount} tax={receipt.tax} />
        <p style={{ marginTop: 8 }}>
          <a className="link" href={`/c/${encodeURIComponent(sessionId)}/receipt`} target="_blank" rel="noreferrer">
            Download receipt (PDF)
          </a>
        </p>
        <div className="divider" />
        <div className="payto-row">
          <span className="label">Paid</span>
          <span className="line-amount">{receipt.settledLabel}</span>
        </div>
        <div className="payto-row">
          <span className="label">Network</span>
          <span className="badge badge-network">
            {receipt.networkName}
          </span>
        </div>
        <div className="payto-row">
          <span className="label">Confirmed</span>
          <span>{formatTimestamp(receipt.confirmedAt)}</span>
        </div>
        <div className="payto-row">
          <span className="label">Transaction</span>
          {receipt.txHash && receipt.explorerUrl ? (
            <a
              className="link mono"
              href={receipt.explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              {truncateMiddle(receipt.txHash, 10, 8)}
            </a>
          ) : receipt.txHash ? (
            <span className="mono">{truncateMiddle(receipt.txHash, 10, 8)}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </div>
        <div className="payto-row">
          <span className="label">Payment ID</span>
          <span className="mono">{receipt.paymentId}</span>
        </div>
      </div>

      {buyerEntries.length > 0 ? (
        <div className="card">
          <h2>Delivery details</h2>
          {buyerEntries.map(([key, value]) => (
            <div className="payto-row" key={key}>
              <span className="label">{key}</span>
              <span className="mono">{value}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="card">
        <h2>Your access</h2>
        <AccessList access={receipt.access} />
      </div>

      <div className="center">
        {receipt.returnUrl ? (
          <a className="btn btn-primary" href={receipt.returnUrl}>
            Continue to {new URL(receipt.returnUrl).host}
          </a>
        ) : (
          <Link className="link" href="/">
            Back to checkout
          </Link>
        )}
      </div>
    </div>
  );
}
