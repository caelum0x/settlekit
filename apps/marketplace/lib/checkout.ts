/**
 * Build links into the SettleKit hosted checkout app. A checkout session is
 * created by the checkout app from a listing's underlying product; here we only
 * construct the deep link that initiates that session with real query params.
 */

const CHECKOUT_BASE =
  process.env.NEXT_PUBLIC_CHECKOUT_URL ?? "http://localhost:3000";

export interface CheckoutLinkParams {
  productId: string;
  listingId: string;
  /** Origin tag so checkout attributes the sale to the marketplace. */
  source?: string;
}

/** Construct the hosted checkout URL for a listing's product. */
export function checkoutUrl(params: CheckoutLinkParams): string {
  const search = new URLSearchParams({
    productId: params.productId,
    listingId: params.listingId,
    source: params.source ?? "marketplace",
  });
  return `${CHECKOUT_BASE}/session?${search.toString()}`;
}
