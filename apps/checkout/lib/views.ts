/**
 * View builders: turn resolved domain objects into the JSON wire shapes the
 * pages + client consume. Keeps the route handlers thin.
 */
import {
  money,
  multiplyMoney,
  type Payment,
} from "@settlekit/common";

import { anyTokenAvailability, getRoutingRuntime, type RoutingRuntimeResult } from "./any-token";
import { requiredFieldsForDelivery } from "./fields";
import { formatZecAmount } from "@settlekit/zcash";

import { describeNetwork, explorerTxUrl, formatAmount } from "./format";
import { buildNetworkOptions, networkEnv } from "./network-options";
import { configuredSolanaCluster } from "./solana";
import { defaultVerifyDeps } from "./store";
import type { VerifyDeps } from "./verify-payment";
import type {
  CheckoutSessionView,
  DeliveredAccess,
  OrderLine,
  ReceiptView,
} from "./types";
import type { ResolvedSession } from "./store";

/** Build the order lines for a resolved session. */
function buildLines(resolved: ResolvedSession): OrderLine[] {
  const { session, product, price } = resolved;
  return session.lineItems.map((line) => {
    const unit = money(price.amount, price.currency);
    return {
      priceId: line.priceId,
      productId: line.productId,
      bundleId: line.bundleId,
      name: product.name,
      description: product.description,
      quantity: line.quantity,
      unitAmount: unit,
      lineTotal: multiplyMoney(unit, line.quantity),
    };
  });
}

/** Build the full session view returned to the checkout page + client. */
export function buildSessionView(
  resolved: ResolvedSession,
  verify: VerifyDeps = defaultVerifyDeps(),
  routing: RoutingRuntimeResult = getRoutingRuntime(),
): CheckoutSessionView {
  const { session, deliveryAction, merchantName, expired } = resolved;
  const options = buildNetworkOptions(session, verify);
  const current = options.find((option) => option.network === session.network);
  if (current === undefined) throw new Error(`session ${session.id} has no option for its own network`);
  return {
    id: session.id,
    status: session.status,
    network: session.network,
    payToAddress: session.payToAddress,
    amount: session.amount,
    lines: buildLines(resolved),
    collectedFields: session.collectedFields,
    requiredFields: requiredFieldsForDelivery(deliveryAction),
    expiresAt: session.expiresAt,
    expired,
    merchantName,
    networkOption: current,
    networkOptions: options.filter((option) => option.available),
    settlementQuote: session.settlementQuote ?? null,
    payerAddress: session.payerAddress ?? null,
    anyToken: anyTokenAvailability(session, verify, routing),
  };
}

/** What the buyer paid on-chain, in the settlement asset. */
function settledLabel(resolved: ResolvedSession, payment: Payment, asset: string): string {
  const quote = resolved.session.settlementQuote;
  if (payment.network === "zcash" && quote !== undefined) {
    return `${formatZecAmount(BigInt(quote.amountBase))} ZEC (${formatAmount(payment.amount.amount)} USD)`;
  }
  return `${formatAmount(payment.amount.amount)} ${asset}`;
}

/** Build the receipt view for a confirmed payment. */
export function buildReceiptView(
  resolved: ResolvedSession,
  payment: Payment,
  access: DeliveredAccess[],
  verify: VerifyDeps = defaultVerifyDeps(),
): ReceiptView {
  const env = networkEnv(payment.network, verify);
  const label = describeNetwork(payment.network, env);
  return {
    sessionId: resolved.session.id,
    paymentId: payment.id,
    txHash: payment.txHash ?? "",
    explorerUrl: payment.txHash
      ? explorerTxUrl(payment.network, payment.txHash, { solanaCluster: configuredSolanaCluster(), chainEnv: env })
      : "",
    network: payment.network,
    networkName: label.name,
    asset: label.asset,
    settledLabel: settledLabel(resolved, payment, label.asset),
    amount: payment.amount,
    confirmedAt: payment.confirmedAt ?? payment.createdAt,
    lines: buildLines(resolved),
    buyer: resolved.session.collectedFields,
    access,
  };
}
