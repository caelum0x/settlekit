/**
 * Reusable payment links.
 *
 * A product's link (`/l/<slug>` on the checkout app) is permanent; every
 * visit asks the API for a FRESH checkout session bound to the merchant's
 * current networks + receiving addresses, so one link can be shared forever
 * while each buyer still gets their own single-use session (own Solana Pay
 * reference, own Zcash quote, own payer binding).
 */
import { notFound, validationError, type CheckoutSession, type PaymentNetwork, type Product } from "@settlekit/common";
import { createCheckoutSession } from "@settlekit/payments";
import type { AppContext } from "../context.js";
import { withNetworkBindings } from "../routes/checkout-sessions.js";
import { saveZcashSession } from "../routes/zcash-quote.js";
import { payToFor } from "../routes/payment-verification.js";
import { loadProfile } from "./profile.js";
import { applyPromo } from "./session-promo.js";
import { networkCatalog } from "./network-catalog.js";
import { activePrice, findBySlug, merchantIdFor } from "./products.js";

/** Public, non-sensitive summary of a payment link. */
export interface PaymentLinkSummary {
  slug: string;
  productId: string;
  name: string;
  description: string;
  merchantName: string;
  priceUsd: string;
  interval: string;
  networks: { network: PaymentNetwork; name: string; asset: string; env: string }[];
}

interface ResolvedLink {
  product: Product;
  priceId: string;
  priceUsd: string;
  interval: string;
  merchantName: string;
  accepted: PaymentNetwork[];
  payTo: Partial<Record<PaymentNetwork, string>>;
}

/**
 * Networks an org can be paid on right now, in checkout order: the merchant's
 * accepted networks that have a receiving address, optionally narrowed to a
 * product's list, with networks this deployment can verify first.
 */
export async function payableNetworks(
  ctx: AppContext,
  organizationId: string,
  productNetworks: readonly PaymentNetwork[] | null = null,
): Promise<{ merchantName: string; accepted: PaymentNetwork[]; payTo: Partial<Record<PaymentNetwork, string>> }> {
  const profile = await loadProfile(ctx, organizationId);
  const enabled = new Set(networkCatalog().filter((n) => n.enabled).map((n) => n.network));
  const accepted = profile.acceptedNetworks
    .filter((n) => profile.payToByNetwork[n] !== undefined)
    .filter((n) => productNetworks === null || productNetworks.includes(n))
    // Networks this deployment can verify come first (the default network).
    .sort((a, b) => Number(enabled.has(b)) - Number(enabled.has(a)));
  return { merchantName: profile.orgName, accepted, payTo: profile.payToByNetwork };
}

async function resolveLink(ctx: AppContext, slug: string): Promise<ResolvedLink> {
  const product = await findBySlug(ctx, slug);
  if (!product || product.status !== "active") throw notFound("This payment link is not active");
  const price = await activePrice(ctx, product.id);
  if (!price) throw notFound("This payment link has no price yet");
  const productNetworks = Array.isArray(product.metadata.acceptedNetworks)
    ? (product.metadata.acceptedNetworks as PaymentNetwork[])
    : null;
  const { merchantName, accepted, payTo } = await payableNetworks(ctx, product.organizationId, productNetworks);
  if (accepted.length === 0) throw notFound("The seller has not finished setting up payments");
  return {
    product,
    priceId: price.id,
    priceUsd: price.amount,
    interval: price.interval,
    merchantName,
    accepted,
    payTo,
  };
}

export async function linkSummary(ctx: AppContext, slug: string): Promise<PaymentLinkSummary> {
  const link = await resolveLink(ctx, slug);
  const catalog = networkCatalog();
  return {
    slug,
    productId: link.product.id,
    name: link.product.name,
    description: link.product.description,
    merchantName: link.merchantName,
    priceUsd: link.priceUsd,
    interval: link.interval,
    networks: link.accepted.flatMap((n) => {
      const row = catalog.find((r) => r.network === n);
      return row ? [{ network: n, name: row.name, asset: row.asset, env: row.env }] : [];
    }),
  };
}

/** Attach network bindings, dropping Zcash when its quote is unavailable. */
export async function bindSession(ctx: AppContext, draft: CheckoutSession): Promise<CheckoutSession> {
  try {
    return await withNetworkBindings(ctx, draft);
  } catch (err) {
    // A ZEC price outage must not take the whole link down: drop Zcash
    // for this session and keep every other network payable.
    const accepted = draft.acceptedNetworks ?? [draft.network];
    if (!accepted.includes("zcash") || accepted.length === 1) throw err;
    const rest: PaymentNetwork[] = accepted.filter((n) => n !== "zcash");
    const payTo: Partial<Record<PaymentNetwork, string>> = Object.fromEntries(
      Object.entries(draft.payToByNetwork ?? {}).filter(([n]) => n !== "zcash"),
    );
    const network: PaymentNetwork = rest.includes(draft.network) ? draft.network : rest[0]!;
    return withNetworkBindings(ctx, {
      ...draft,
      network,
      payToAddress: payTo[network] ?? draft.payToAddress,
      acceptedNetworks: rest,
      payToByNetwork: payTo,
    });
  }
}

/** Open a fresh checkout session for a payment link visit. */
export async function openLinkSession(
  ctx: AppContext,
  slug: string,
  options: { successUrl?: string; cancelUrl?: string; promo?: string } = {},
): Promise<CheckoutSession> {
  const link = await resolveLink(ctx, slug);
  const price = await ctx.prices.findById(link.priceId);
  if (!price) throw validationError("price vanished");
  const network = link.accepted[0]!;
  const payToByNetwork = Object.fromEntries(link.accepted.map((n) => [n, link.payTo[n]!])) as Partial<
    Record<PaymentNetwork, string>
  >;
  const draft = createCheckoutSession({
    organizationId: link.product.organizationId,
    merchantId: merchantIdFor(link.product.organizationId),
    items: [{ lineItem: { productId: link.product.id, priceId: price.id, quantity: 1 }, price }],
    payToAddress: payToByNetwork[network]!,
    network,
    ttlDays: 1,
    ...(options.successUrl ? { successUrl: options.successUrl } : {}),
    ...(options.cancelUrl ? { cancelUrl: options.cancelUrl } : {}),
  });
  const discounted = options.promo ? await applyPromo(ctx, draft, options.promo, new Map([[price.id, price]])) : draft;
  const session = await bindSession(ctx, { ...discounted, acceptedNetworks: link.accepted, payToByNetwork });
  return session.settlementQuote !== undefined
    ? saveZcashSession(ctx, { ...session, settlementQuote: session.settlementQuote }, payToFor(session, "zcash"))
    : ctx.checkouts.save(session);
}

/** Persist a bound session (Zcash sessions reserve their amount tag atomically). */
export function saveBoundSession(ctx: AppContext, session: CheckoutSession): Promise<CheckoutSession> {
  return session.settlementQuote !== undefined
    ? saveZcashSession(ctx, { ...session, settlementQuote: session.settlementQuote }, payToFor(session, "zcash"))
    : ctx.checkouts.save(session);
}
