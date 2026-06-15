import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getReceipt, ApiClientError } from "@/lib/api";
import {
  formatMoney,
  formatNetwork,
  formatTimestamp,
  explorerTxUrl,
  truncateMiddle,
} from "@/lib/format";
import { OrderSummary } from "@/components/OrderSummary";
import { AccessList } from "@/components/AccessList";

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

  // The receipt amount is the authoritative settled total.
  const total = receipt.amount;
  const buyerEntries = Object.entries(receipt.buyer);

  return (
    <div>
      <div className="card center">
        <div className="big-status">Payment confirmed</div>
        <p className="muted">
          Your USDC payment settled and access has been delivered.
        </p>
      </div>

      <div className="card">
        <h2>Receipt</h2>
        <OrderSummary lines={receipt.lines} total={total} />
        <div className="divider" />
        <div className="payto-row">
          <span className="label">Paid</span>
          <span className="line-amount">{formatMoney(receipt.amount)}</span>
        </div>
        <div className="payto-row">
          <span className="label">Network</span>
          <span className="badge badge-network">
            {formatNetwork(receipt.network)}
          </span>
        </div>
        <div className="payto-row">
          <span className="label">Confirmed</span>
          <span>{formatTimestamp(receipt.confirmedAt)}</span>
        </div>
        <div className="payto-row">
          <span className="label">Transaction</span>
          {receipt.txHash ? (
            <a
              className="link mono"
              href={explorerTxUrl(receipt.network, receipt.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              {truncateMiddle(receipt.txHash, 10, 8)}
            </a>
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
        <Link className="link" href="/">
          Back to checkout
        </Link>
      </div>
    </div>
  );
}
