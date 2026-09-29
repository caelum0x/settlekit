import { notFound, redirect } from "next/navigation";

import { getCheckoutSession, ApiClientError } from "@/lib/api";
import { badgeDescription, badgeText, formatAmount, formatExpiry, formatMoney } from "@/lib/format";
import { OrderSummary } from "@/components/OrderSummary";
import { NetworkPicker } from "@/components/NetworkPicker";
import { AnyTokenPay, EvmPay, HyperCorePay, SolanaPay, WalletPay, ZcashPay } from "@/components/LazyPay";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { sessionId: string };
}

/**
 * Hosted checkout page. Server-fetches the checkout session from the SettleKit
 * API, renders the order summary, a network picker (accepted networks this
 * checkout can verify) and the flow for the chosen network: SolanaPay,
 * EvmPay (every EVM chain), HyperCorePay or ZcashPay, plus "pay with any
 * token" (AnyTokenPay, real Relay/LI.FI routes) when routing is enabled for
 * the network. Expired sessions redirect to the
 * /expired page; completed sessions redirect to /success.
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

  const option = session.networkOption;
  const family = option.family;
  const amountLabel = `${formatAmount(session.amount.amount)} ${option.asset}`;
  // The Arc demo wallet (offline simulation) only applies to Arc sessions.
  const isArc = session.network === "arc";

  return (
    <div>
      <div className="card">
        <h2>Order summary</h2>
        <p className="merchant">Sold by {session.merchantName}</p>
        <OrderSummary lines={session.lines} total={session.amount} />
      </div>

      <div className="card">
        <h2>Payment</h2>
        <NetworkPicker sessionId={session.id} current={session.network} options={session.networkOptions} />
        <div className="payto">
          <div className="payto-row">
            <span className="label">Amount due</span>
            <span className="line-amount">
              {family === "zcash" ? `${formatMoney(session.amount)} in ZEC` : amountLabel}
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Network</span>
            <span className="network-badges">
              <span className="badge badge-network">{option.name}</span>
              {option.badges.map((badge) => (
                <span key={badge} className={`badge badge-${badge}`} title={badgeDescription(badge)}>
                  {badgeText(badge)}
                </span>
              ))}
            </span>
          </div>
          <div className="payto-row">
            <span className="label">Window</span>
            <span className="badge badge-expiry">
              {formatExpiry(session.expiresAt)}
            </span>
          </div>
        </div>

        {!option.available ? (
          <div className="alert alert-error" role="alert">
            {option.name} is not available on this checkout: {option.unavailableReason}
            {session.networkOptions.length > 0 ? " Choose another network above." : ""}
          </div>
        ) : family === "solana" ? (
          <SolanaPay
            sessionId={session.id}
            amountLabel={amountLabel}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        ) : family === "hypercore" ? (
          <HyperCorePay
            key={session.network}
            sessionId={session.id}
            networkName={option.name}
            amountLabel={amountLabel}
            payToAddress={session.payToAddress}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        ) : family === "zcash" ? (
          <ZcashPay
            key={session.network}
            sessionId={session.id}
            usdLabel={formatMoney(session.amount)}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        ) : (
          <EvmPay
            key={session.network}
            sessionId={session.id}
            network={session.network}
            networkName={option.name}
            assetLabel={option.asset}
            amountLabel={amountLabel}
            payToAddress={session.payToAddress}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        )}
      </div>

      {option.available && session.anyToken.available ? (
        <div className="card">
          <h2>Pay with any token</h2>
          <AnyTokenPay
            key={session.network}
            sessionId={session.id}
            networkName={option.name}
            amountLabel={amountLabel}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        </div>
      ) : null}

      {isArc && option.available ? (
        <div className="card">
          <h2>Arc demo wallet (simulation)</h2>
          <p className="hint">
            Offline App Kit simulation for the Arc testnet demo: it returns a synthetic transaction and does not pay
            this order. Use the payment form above to pay.
          </p>
          <WalletPay amount={session.amount.amount} payToAddress={session.payToAddress} />
        </div>
      ) : null}
    </div>
  );
}
