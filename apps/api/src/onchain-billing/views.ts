/**
 * Read models for onchain subscriptions: what the merchant dashboard's
 * Subscriptions page and the buyer's manage page render (status, next
 * charge, what the buyer authorized, dunning state, charge history with
 * explorer links). Never exposes the pending intent's typed data.
 */
import { fromBaseUnits } from "@settlekit/common";
import type { OnchainCharge, OnchainSubscription, OnchainBillingRuntime } from "@settlekit/onchain-billing";
import type { AppContext } from "../context.js";
import { explorerTxUrl, networkInfo } from "../merchant/network-catalog.js";

export interface ChargeView {
  id: string;
  periodIndex: number;
  status: OnchainCharge["status"];
  amount: string;
  attempt: number;
  txHash: string | null;
  explorerUrl: string | null;
  failureReason: string | null;
  invoiceRef: string | null;
  updatedAt: string;
}

export interface OnchainSubscriptionView {
  id: string;
  subscriptionId: string | null;
  status: OnchainSubscription["status"];
  /** past_due / suspended mean dunning is running or exhausted. */
  dunning: "none" | "retrying" | "suspended";
  network: OnchainSubscription["network"];
  networkName: string;
  method: OnchainSubscription["method"];
  customerId: string;
  customerEmail: string | null;
  payer: string;
  payTo: string;
  productId: string;
  productName: string;
  priceId: string;
  amountPerPeriod: string;
  interval: "monthly" | "yearly";
  periodsCovered: number;
  /** price x periods: the most the buyer's grant allows in total. */
  cap: string;
  /** When the buyer's grant stops allowing pulls (null before activation). */
  grantExpiresAt: string | null;
  currentPeriodEnd: string | null;
  /** Next scheduled pull / invoice; null when canceled or ending at period end. */
  nextChargeAt: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  lastChargeError: string | null;
  lastCharge: ChargeView | null;
  charges: ChargeView[];
  createdAt: string;
}

const YEAR_SECONDS = 360 * 86_400;

function at(anchorAt: string | undefined, seconds: number): string | null {
  if (!anchorAt) return null;
  return new Date(new Date(anchorAt).getTime() + seconds * 1000).toISOString();
}

export function chargeView(charge: OnchainCharge, network: OnchainSubscription["network"]): ChargeView {
  return {
    id: charge.id,
    periodIndex: charge.periodIndex,
    status: charge.status,
    amount: fromBaseUnits(BigInt(charge.amount)),
    attempt: charge.attempt,
    txHash: charge.txHash ?? null,
    explorerUrl: charge.txHash ? explorerTxUrl(network, charge.txHash) : null,
    failureReason: charge.failureReason ?? null,
    invoiceRef: charge.invoiceRef ?? null,
    updatedAt: charge.updatedAt,
  };
}

export async function onchainSubscriptionView(
  ctx: AppContext,
  runtime: OnchainBillingRuntime,
  sub: OnchainSubscription,
): Promise<OnchainSubscriptionView> {
  const charges = [...(await runtime.store.listCharges(sub.id))].sort(
    (a, b) => a.periodIndex - b.periodIndex || a.attempt - b.attempt,
  );
  const product = await ctx.products.findById(sub.productId);
  const active = sub.status === "active" || sub.status === "past_due";
  const paidEnd = sub.paidThrough >= 0 ? at(sub.anchorAt, (sub.paidThrough + 1) * sub.periodSeconds) : null;
  const next = active && !sub.cancelAtPeriodEnd ? (paidEnd ?? at(sub.anchorAt, 0)) : null;
  const views = charges.map((charge) => chargeView(charge, sub.network));
  return {
    id: sub.id,
    subscriptionId: sub.subscriptionId ?? null,
    status: sub.status,
    dunning: sub.status === "past_due" ? "retrying" : sub.status === "suspended" ? "suspended" : "none",
    network: sub.network,
    networkName: networkInfo(sub.network)?.name ?? sub.network,
    method: sub.method,
    customerId: sub.customerId,
    customerEmail: sub.customerEmail ?? null,
    payer: sub.payer,
    payTo: sub.payTo,
    productId: sub.productId,
    productName: product?.name ?? sub.productId,
    priceId: sub.priceId,
    amountPerPeriod: sub.amountDisplay,
    interval: sub.periodSeconds >= YEAR_SECONDS ? "yearly" : "monthly",
    periodsCovered: sub.periodsCovered,
    cap: fromBaseUnits(BigInt(sub.amountPerPeriod) * BigInt(sub.periodsCovered)),
    grantExpiresAt: sub.status === "pending_grant" ? null : at(sub.anchorAt, sub.periodsCovered * sub.periodSeconds),
    currentPeriodEnd: paidEnd,
    nextChargeAt: next,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    canceledAt: sub.canceledAt ?? null,
    lastChargeError: sub.lastChargeError ?? null,
    lastCharge: views.at(-1) ?? null,
    charges: views,
    createdAt: sub.createdAt,
  };
}
