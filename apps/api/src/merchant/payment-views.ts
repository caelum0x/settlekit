/**
 * Merchant-facing payment views: a payment joined with the checkout session
 * it paid (asset, payer, any-token route, buyer fields), the products it
 * bought, and — for the detail view — its timeline, entitlements, delivery
 * runs and refunds.
 */
import type {
  CheckoutSession,
  DeliveryRun,
  Entitlement,
  Payment,
  PaymentNetwork,
  Product,
} from "@settlekit/common";
import type { Refund } from "@settlekit/refunds";
import type { AppContext } from "../context.js";
import { explorerTxUrl, networkInfo } from "./network-catalog.js";

/** How the payment arrived. */
export type PaymentSource = "checkout" | "agent_x402" | "agent_mpp" | "direct";

export interface PaymentView {
  id: string;
  status: Payment["status"];
  network: PaymentNetwork;
  networkName: string;
  env: "mainnet" | "testnet";
  asset: string;
  /** Invoiced USD amount. */
  amountUsd: string;
  /** What actually moved on-chain when it differs from USD (Zcash). */
  settled?: { amount: string; asset: string };
  txHash: string | null;
  explorerUrl: string | null;
  source: PaymentSource;
  createdAt: string;
  confirmedAt: string | null;
  buyer: {
    customerId: string;
    email: string | null;
    githubUsername: string | null;
    discordUserId: string | null;
    wallet: string | null;
  };
  products: { id: string; name: string }[];
  routedFrom: {
    provider: string;
    originChainId: number;
    originToken: string;
    originTxHash: string | null;
    state: string;
  } | null;
}

export interface TimelineStep {
  key: "created" | "paid" | "verified" | "delivered" | "refunded";
  label: string;
  at: string | null;
  done: boolean;
  detail?: string;
}

export interface PaymentDetail extends PaymentView {
  sessionId: string | null;
  timeline: TimelineStep[];
  entitlements: Entitlement[];
  deliveryRuns: DeliveryRun[];
  refunds: (Refund & { explorerUrl: string | null })[];
}

/** Classify a payment by the session id convention of each rail. */
export function paymentSource(payment: Payment): PaymentSource {
  const id = payment.checkoutSessionId;
  if (id.startsWith("x402:")) return "agent_x402";
  if (id.startsWith("mpp:")) return "agent_mpp";
  if (id.startsWith("direct:")) return "direct";
  return "checkout";
}

function zecAmount(session: CheckoutSession | null): PaymentView["settled"] {
  const quote = session?.settlementQuote;
  if (!quote) return undefined;
  const zats = BigInt(quote.amountBase);
  const whole = zats / 100_000_000n;
  const frac = (zats % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
  return { amount: frac ? `${whole}.${frac}` : `${whole}`, asset: "ZEC" };
}

/** Build views for many payments, loading each session/product once. */
export async function buildPaymentViews(ctx: AppContext, payments: readonly Payment[]): Promise<PaymentView[]> {
  const productCache = new Map<string, Promise<Product | null>>();
  const product = (id: string): Promise<Product | null> => {
    let hit = productCache.get(id);
    if (!hit) {
      hit = ctx.products.findById(id);
      productCache.set(id, hit);
    }
    return hit;
  };
  return Promise.all(
    payments.map(async (payment) => {
      const session = paymentSource(payment) === "checkout" ? await ctx.checkouts.findById(payment.checkoutSessionId) : null;
      return toView(payment, session, product);
    }),
  );
}

async function toView(
  payment: Payment,
  session: CheckoutSession | null,
  product: (id: string) => Promise<Product | null>,
): Promise<PaymentView> {
  const info = networkInfo(payment.network);
  const fields = session?.collectedFields ?? {};
  const productIds = [...new Set((session?.lineItems ?? []).flatMap((li) => (li.productId ? [li.productId] : [])))];
  const products = (await Promise.all(productIds.map(product))).flatMap((p) => (p ? [{ id: p.id, name: p.name }] : []));
  const route = session?.route;
  const settled = payment.network === "zcash" ? zecAmount(session) : undefined;
  return {
    id: payment.id,
    status: payment.status,
    network: payment.network,
    networkName: info?.name ?? payment.network,
    env: info?.env ?? "mainnet",
    asset: info?.asset ?? payment.amount.currency,
    amountUsd: payment.amount.amount,
    ...(settled ? { settled } : {}),
    txHash: payment.txHash ?? null,
    explorerUrl: payment.txHash ? explorerTxUrl(payment.network, payment.txHash) : null,
    source: paymentSource(payment),
    createdAt: payment.createdAt,
    confirmedAt: payment.confirmedAt ?? null,
    buyer: {
      customerId: payment.customerId,
      email: fields.email ?? null,
      githubUsername: fields.githubUsername ?? null,
      discordUserId: fields.discordUserId ?? null,
      wallet: session?.payerAddress ?? route?.originAddress ?? null,
    },
    products,
    routedFrom: route
      ? {
          provider: route.provider,
          originChainId: route.originChainId,
          originToken: route.originToken,
          originTxHash: route.originTxHash ?? null,
          state: route.state,
        }
      : null,
  };
}

function deliveredAt(entitlements: Entitlement[], runs: DeliveryRun[]): { at: string | null; detail?: string } {
  const finished = runs.find((r) => r.status === "succeeded");
  if (finished) return { at: finished.completedAt ?? finished.createdAt, detail: "Delivery run succeeded" };
  const active = entitlements.find((e) => e.status === "active");
  if (active) return { at: active.createdAt, detail: `Access granted (${active.entitlementType.replace(/_/g, " ")})` };
  const pending = entitlements.find((e) => e.status === "pending");
  if (pending) return { at: null, detail: "Access pending (waiting on the delivery integration)" };
  const failed = runs.find((r) => r.status === "failed" || r.status === "partially_failed");
  if (failed) return { at: null, detail: "Delivery failed; retry from Delivery runs" };
  return { at: null };
}

/** The full detail view for one (already ownership-checked) payment. */
export async function buildPaymentDetail(ctx: AppContext, payment: Payment): Promise<PaymentDetail> {
  const [view] = await buildPaymentViews(ctx, [payment]);
  const source = paymentSource(payment);
  const session = source === "checkout" ? await ctx.checkouts.findById(payment.checkoutSessionId) : null;
  const entitlements = (await ctx.entitlementRepo.listByCustomer(payment.customerId)).filter(
    (e) => e.grantedBy.type === "payment" && e.grantedBy.id === payment.id && e.organizationId === payment.organizationId,
  );
  const deliveryRuns = await ctx.deliveryRuns.list((r) => r.paymentId === payment.id && r.organizationId === payment.organizationId);
  const refunds = await ctx.refunds.listByPayment(payment.id);
  const delivered = deliveredAt(entitlements, deliveryRuns);
  const refunded = refunds.find((r) => r.status === "succeeded");
  const verified = payment.status === "confirmed" || payment.status === "refunded";

  const timeline: TimelineStep[] = [
    { key: "created", label: "Checkout created", at: session?.createdAt ?? payment.createdAt, done: true },
    {
      key: "paid",
      label: "Buyer paid",
      at: payment.txHash ? payment.createdAt : null,
      done: payment.txHash !== undefined,
      ...(view!.routedFrom ? { detail: `Routed via ${view!.routedFrom.provider} from chain ${view!.routedFrom.originChainId}` } : {}),
    },
    {
      key: "verified",
      label: "Verified on-chain",
      at: payment.confirmedAt ?? null,
      done: verified,
      ...(verified ? { detail: `${payment.confirmations} confirmation${payment.confirmations === 1 ? "" : "s"}` } : {}),
    },
    { key: "delivered", label: "Access delivered", at: delivered.at, done: delivered.at !== null, ...(delivered.detail ? { detail: delivered.detail } : {}) },
  ];
  if (refunded || payment.status === "refunded") {
    timeline.push({
      key: "refunded",
      label: "Refunded",
      at: refunded?.updatedAt ?? null,
      done: true,
      ...(refunded?.txHash ? { detail: `Refund tx ${refunded.txHash}` } : {}),
    });
  }
  return {
    ...view!,
    sessionId: session?.id ?? null,
    timeline,
    entitlements,
    deliveryRuns,
    refunds: refunds.map((r) => ({ ...r, explorerUrl: r.txHash ? explorerTxUrl(payment.network, r.txHash) : null })),
  };
}
