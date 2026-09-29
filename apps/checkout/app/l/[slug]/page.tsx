import { notFound } from "next/navigation";

import { PaymentLinkError, getPaymentLink } from "@/lib/payment-link";
import { StartCheckout } from "@/components/StartCheckout";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { slug: string };
  searchParams: { error?: string };
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

  return (
    <div>
      <div className="card">
        <p className="merchant">Sold by {link.merchantName}</p>
        <h2>{link.name}</h2>
        {link.description ? <p className="line-desc">{link.description}</p> : null}
        <div className="total">
          <span>Price</span>
          <span>
            ${link.priceUsd}
            {INTERVAL_LABEL[link.interval] ?? ""}
          </span>
        </div>
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
        <StartCheckout slug={link.slug} auto={!searchParams.error} />
      </div>
    </div>
  );
}
