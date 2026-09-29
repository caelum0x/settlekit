/**
 * Buyer manage page data (`/s/<token>`): the subscription read model and the
 * buyer cancel, fetched from /v1/onchain-billing with the checkout's service
 * token for the seller named in the signed token.
 */
import { billingApi, type BuyerAction, type SubscriptionView } from "./billing-api";
import { CheckoutError } from "./errors";
import { verifyManageToken } from "./manage-token";

export interface ManagedSubscription {
  view: SubscriptionView;
  sellerOrg: string;
}

export interface CancelManagedResult {
  view: SubscriptionView;
  /** What the buyer's wallet should run to revoke on-chain (null when nothing is needed). */
  revoke: BuyerAction | null;
  /** Revocation the operator already sent (smart wallet spend permissions). */
  operatorRevokeTx: string | null;
}

function claims(token: string): { subscriptionId: string; organizationId: string } {
  const parsed = verifyManageToken(token);
  if (!parsed) throw new CheckoutError("session_not_found", "This subscription link is not valid.");
  return parsed;
}

export async function getManagedSubscription(token: string): Promise<ManagedSubscription> {
  const { subscriptionId, organizationId } = claims(token);
  const { view } = await billingApi.subscription(organizationId, subscriptionId);
  return { view, sellerOrg: organizationId };
}

export async function cancelManagedSubscription(token: string): Promise<CancelManagedResult> {
  const { subscriptionId, organizationId } = claims(token);
  const result = await billingApi.cancel(organizationId, subscriptionId);
  return { view: result.view, revoke: result.buyerRevoke ?? null, operatorRevokeTx: result.operatorRevokeTx ?? null };
}
