import { notFound, redirect } from "next/navigation";

import { getCheckoutSession, ApiClientError } from "@/lib/api";
import { formatMoney, formatNetwork, formatExpiry } from "@/lib/format";
import { OrderSummary } from "@/components/OrderSummary";
import { PaymentForm } from "@/components/PaymentForm";
import { WalletPay } from "@/components/WalletPay";
import { BridgePay } from "@/components/BridgePay";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { sessionId: string };
}

/**
 * Hosted checkout page. Server-fetches the checkout session from the SettleKit
 * API, renders the order summary + pay-to details, and mounts the client
 * PaymentForm. Expired sessions redirect to the /expired page; completed
 * sessions redirect to /success.
 */
export default async function CheckoutPage({ params }: PageProps) {
  const { sessionId } = params;

  let session;
  try {
    session = await getCheckoutSession(sessionId);
  } catch (error) {
    if (error instanceof ApiClientError) {
      if (error.notFound) notFound();
      if (error.expired) redirect(`/c/${sessionId}/expired`);
    }
    throw error;
  }

  if (session.status === "completed") {
    redirect(`/c/${sessionId}/success`);
  }
  if (session.status === "expired" || session.expired) {
    redirect(`/c/${sessionId}/expired`);
  }

  return (
    <div>
      <div className="card">
        <h2>Order summary</h2>
        <p className="merchant">Sold by {session.merchantName}</p>
        <OrderSummary lines={session.lines} total={session.amount} />
      </div>

      <div className="card">
        <h2>Payment</h2>
        <div className="payto">
          <div className="payto-row">
            <span className="label">Amount due</span>
            <span className="line-amount">{formatMoney(session.amount)}</span>
          </div>
          <div className="payto-row">
            <span className="label">Network</span>
            <span className="badge badge-network">
              {formatNetwork(session.network)}
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Window</span>
            <span className="badge badge-expiry">
              {formatExpiry(session.expiresAt)}
            </span>
          </div>
        </div>

        <PaymentForm
          sessionId={session.id}
          amountLabel={formatMoney(session.amount)}
          payToAddress={session.payToAddress}
          network={session.network}
          requiredFields={session.requiredFields}
          initialValues={session.collectedFields}
        />
      </div>

      <div className="card">
        <h2>Pay with wallet</h2>
        <WalletPay amount={session.amount.amount} payToAddress={session.payToAddress} />
      </div>

      <div className="card">
        <h2>Pay from another chain</h2>
        <BridgePay amount={session.amount.amount} />
      </div>
    </div>
  );
}
