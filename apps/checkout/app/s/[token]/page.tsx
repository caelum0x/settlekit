import { notFound } from "next/navigation";

import { ManageSubscription } from "@/components/ManageSubscription";
import { CheckoutError } from "@/lib/errors";
import { getManagedSubscription } from "@/lib/manage-subscription";
import { verifyManageToken } from "@/lib/manage-token";
import { configuredSolanaCluster } from "@/lib/solana";

export const dynamic = "force-dynamic";

interface PageProps {
  params: { token: string };
}

/**
 * Buyer "manage subscription" page. The signed link (shown after subscribing)
 * is the credential: it shows the status, next charge, what the wallet
 * authorized and every charge, and lets the buyer cancel and revoke.
 */
export default async function ManageSubscriptionPage({ params }: PageProps) {
  if (!verifyManageToken(params.token)) notFound();
  let managed;
  try {
    managed = await getManagedSubscription(params.token);
  } catch (error) {
    if (error instanceof CheckoutError && error.code === "session_not_found") notFound();
    return (
      <div className="card">
        <h2>Subscription</h2>
        <p className="muted">{error instanceof Error ? error.message : "This subscription could not be loaded."} Try again in a minute.</p>
      </div>
    );
  }
  return <ManageSubscription token={params.token} initial={managed.view} solanaCluster={configuredSolanaCluster()} />;
}
