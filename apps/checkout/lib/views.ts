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
import { discordOAuthSetup } from "./discord-connect";
import type {
  CollectedFieldSpec,
  CheckoutSessionView,
  DeliveredAccess,
  OrderLine,
  ReceiptView,
} from "./types";
import type { ResolvedSession } from "./store";
import { recurringInterval } from "./subscription-checkout";

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

/** Offer "Connect Discord" for the Discord id when the OAuth app is configured. */
function withConnections(
  specs: CollectedFieldSpec[],
  sessionId: string,
  collected: Record<string, string>,
): CollectedFieldSpec[] {
  if (!discordOAuthSetup()) return specs;
  return specs.map((spec) =>
    spec.key === "discordUserId"
      ? {
          ...spec,
          help: "Connect your Discord account so the role goes to the right user.",
          connect: {
            url: `/api/discord/authorize?session=${encodeURIComponent(sessionId)}`,
            label: "Connect Discord",
            connectedAs: collected.discordUserId ? (collected.discordUsername ?? collected.discordUserId) : null,
          },
        }
      : spec,
  );
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
    requiredFields: withConnections(requiredFieldsForDelivery(deliveryAction), session.id, session.collectedFields),
    expiresAt: session.expiresAt,
    expired,
    merchantName,
    networkOption: current,
    networkOptions: options.filter((option) => option.available),
    settlementQuote: session.settlementQuote ?? null,
    payerAddress: session.payerAddress ?? null,
    anyToken: anyTokenAvailability(session, verify, routing),
    recurring: recurringInterval(resolved),
    discount: session.discount
      ? { code: session.discount.couponCode, subtotal: session.discount.subtotal, amountOff: session.discount.amountOff }
      : null,
    tax: session.tax
      ? {
          label: session.tax.label,
          rateBps: session.tax.rateBps,
          amount: session.tax.amount,
          net: session.tax.net,
          jurisdiction: session.tax.jurisdiction,
          reverseCharge: session.tax.reverseCharge,
          country: session.tax.country ?? null,
          vatId: session.tax.vatId ?? null,
        }
      : null,
    taxEditable: session.tax !== undefined && session.invoiceId === undefined && session.status === "open" && !expired,
    promoAllowed: session.discount === undefined && session.invoiceId === undefined && session.status === "open" && !expired,
  };
}

/** Only https return URLs are offered to buyers. */
export function sellerReturnUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
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
    discount: resolved.session.discount
      ? { code: resolved.session.discount.couponCode, amountOff: resolved.session.discount.amountOff }
      : null,
    tax: resolved.session.tax
      ? {
          label: resolved.session.tax.label,
          rateBps: resolved.session.tax.rateBps,
          amount: resolved.session.tax.amount,
          reverseCharge: resolved.session.tax.reverseCharge,
        }
      : null,
    buyer: resolved.session.collectedFields,
    access,
    returnUrl: sellerReturnUrl(resolved.session.successUrl),
  };
}
