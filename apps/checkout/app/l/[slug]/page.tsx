import { notFound } from "next/navigation";

import { PaymentLinkError, getPaymentLink } from "@/lib/payment-link";
import { StartCheckout } from "@/components/StartCheckout";
import { serverT, startLabels } from "@/lib/i18n";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
  searchParams: { error?: string; promo?: string; lang?: string };
}

/** A promo code from the URL, or undefined when absent or malformed. */
function cleanPromo(raw: string | undefined): string | undefined {
  const code = raw?.trim();
  return code && /^[A-Za-z0-9_-]{1,64}$/.test(code) ? code : undefined;
}

const INTERVAL_LABEL: Record<string, string> = { monthly: " / month", yearly: " / year" };

/**
 * Reusable payment link landing. Shows what the buyer is paying for, then
 * opens a fresh checkout session (client-side, so link unfurlers and
 * crawlers never create sessions) and moves the buyer to it.
 */
export default async function PaymentLinkPage({ params, searchParams }: PageProps) {
  let link;
  try {
    link = await getPaymentLink(params.slug);
  } catch (error) {
    if (error instanceof PaymentLinkError && error.status === 404) notFound();
    return (
      <div className="card">
        <h2>Checkout unavailable</h2>
        <p className="muted">
          {error instanceof Error ? error.message : "This payment link could not be loaded."} Try again in a minute.
        </p>
      </div>
    );
  }

  const promo = cleanPromo(searchParams.promo);
  const t = serverT(searchParams.lang);
  return (
    <div>
      <div className="card">
        <p className="merchant">{t("order.soldBy", { merchant: link.merchantName })}</p>
        <h2>{link.name}</h2>
        {link.description ? <p className="line-desc">{link.description}</p> : null}
        <div className="total">
          <span>{t("link.price")}</span>
          <span>
            {link.displayCurrency && link.displayAmount ? `${link.displayAmount} ${link.displayCurrency}` : `$${link.priceUsd}`}
            {INTERVAL_LABEL[link.interval] ?? ""}
          </span>
        </div>
        {link.displayCurrency ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Paid in USDC at the live exchange rate, about {link.priceUsd} USDC now.
          </p>
        ) : null}
        {INTERVAL_LABEL[link.interval] ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Subscribe with one wallet approval capped at the price per period (or renewal invoices by email). Cancel any
            time from your manage link.
          </p>
        ) : null}
        <div className="network-badges" style={{ marginTop: 12 }}>
          {link.networks.map((n) => (
            <span key={n.network} className="badge badge-network" title={`${n.asset} on ${n.name}`}>
              {n.name} {n.asset}
              {n.env === "testnet" ? " (testnet)" : ""}
            </span>
          ))}
        </div>
      </div>
      <div className="card">
        {searchParams.error ? (
          <div className="alert alert-error" role="alert">
            We could not open a checkout just now. Please try again.
          </div>
        ) : null}
        {promo ? (
          <p className="muted" style={{ marginBottom: 10 }}>
            {t("link.promo", { code: promo })}
          </p>
        ) : null}
        <StartCheckout slug={link.slug} auto={!searchParams.error} labels={startLabels(t)} {...(promo ? { promo } : {})} />
      </div>
    </div>
  );
}
