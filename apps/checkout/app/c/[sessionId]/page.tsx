import { notFound, redirect } from "next/navigation";

import { getCheckoutSession, ApiClientError } from "@/lib/api";
import { badgeDescription, badgeText, formatAmount, formatExpiry, formatMoney } from "@/lib/format";
import { OrderSummary } from "@/components/OrderSummary";
import { PromoCode } from "@/components/PromoCode";
import { TaxDetails } from "@/components/TaxDetails";
import { orderLabels, promoLabels, serverT, taxLabels } from "@/lib/i18n";
import { NetworkPicker } from "@/components/NetworkPicker";
import { AnyTokenPay, EvmPay, HyperCorePay, SolanaPay, SubscribePay, WalletPay, ZcashPay } from "@/components/LazyPay";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { sessionId: string };
  searchParams: { discord?: string; promo?: string; lang?: string };
}

const DISCORD_NOTICE: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Discord connected. Your role is added as soon as the payment settles." },
  failed: { ok: false, text: "Discord did not connect. Try again, or enter your user ID manually." },
  canceled: { ok: false, text: "Discord connection was canceled." },
  unavailable: { ok: false, text: "Connecting Discord is not available on this checkout; enter your user ID instead." },
};

/**
 * Hosted checkout page. Server-fetches the checkout session from the SettleKit
 * API, renders the order summary, a network picker (accepted networks this
 * checkout can verify) and the flow for the chosen network: SolanaPay,
 * EvmPay (every EVM chain), HyperCorePay or ZcashPay, plus "pay with any
 * token" (AnyTokenPay, real Relay/LI.FI routes) when routing is enabled for
 * the network. Expired sessions redirect to the
 * /expired page; completed sessions redirect to /success.
 */
export default async function CheckoutPage({ params, searchParams }: PageProps) {
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

  const discordNotice = searchParams.discord ? DISCORD_NOTICE[searchParams.discord] : undefined;
  const t = serverT(searchParams.lang);

  return (
    <div>
      {discordNotice ? (
        <div className={`alert ${discordNotice.ok ? "alert-success" : "alert-error"}`} role="status">
          {discordNotice.text}
        </div>
      ) : null}
      <div className="card">
        <h2>{t("order.title")}</h2>
        <p className="merchant">{t("order.soldBy", { merchant: session.merchantName })}</p>
        <OrderSummary lines={session.lines} total={session.amount} discount={session.discount} tax={session.tax} labels={orderLabels(t)} />
        {session.fx ? (
          <p className="muted" style={{ marginTop: 6 }}>
            {t("fx.note", {
              amount: session.fx.amount,
              currency: session.fx.currency,
              rate: session.fx.rate,
              source: session.fx.source,
              date: session.fx.rateDate,
            })}
          </p>
        ) : null}
        {searchParams.promo === "refused" && !session.discount ? (
          <p className="field-error" role="status">
            {t("promo.refused")}
          </p>
        ) : null}
        {session.promoAllowed ? <PromoCode sessionId={session.id} labels={promoLabels(t)} /> : null}
        {session.tax && session.taxEditable ? (
          <TaxDetails sessionId={session.id} country={session.tax.country} vatId={session.tax.vatId} labels={taxLabels(t)} />
        ) : null}
      </div>

      {session.recurring && option.available ? (
        <div className="card">
          <h2>{t("pay.subscribe")}</h2>
          <SubscribePay
            key={session.network}
            sessionId={session.id}
            requiredFields={session.requiredFields}
            initialValues={session.collectedFields}
          />
        </div>
      ) : null}

      <div className="card">
        <h2>
          {session.recurring
            ? t("pay.oneOff", { period: t(session.recurring === "yearly" ? "pay.year" : "pay.month") })
            : t("pay.title")}
        </h2>
        <NetworkPicker sessionId={session.id} current={session.network} options={session.networkOptions} />
        <div className="payto">
          <div className="payto-row">
            <span className="label">{t("pay.amountDue")}</span>
            <span className="line-amount">
              {family === "zcash" ? `${formatMoney(session.amount)} in ZEC` : amountLabel}
            </span>
          </div>
          <div className="payto-row">
            <span className="label">{t("pay.network")}</span>
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
            <span className="label">{t("pay.window")}</span>
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
          <h2>{t("pay.anyToken")}</h2>
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
