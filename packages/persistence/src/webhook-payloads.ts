/**
 * Seller webhook payloads, built identically by every app so a merchant's
 * endpoint sees one stable shape per event type:
 *
 *   payment.confirmed      a one-time or subscription payment settled on-chain
 *   subscription.charged   an onchain subscription period was collected
 *   subscription.canceled  an onchain subscription was canceled
 *   refund.succeeded       a refund was sent (operator wallet or recorded manually)
 */
import { fromBaseUnits, type Payment } from "@settlekit/common";
import type { OnchainCharge, OnchainSubscription } from "@settlekit/onchain-billing";
import type { WebhookEmitInput } from "./webhook-outbox.js";

export interface PaymentContext {
  customerEmail?: string;
  productIds?: readonly string[];
  /** Checkout collected fields worth forwarding (githubUsername, discordUserId). */
  buyer?: Readonly<Record<string, string>>;
}

export function paymentConfirmedWebhook(payment: Payment, context: PaymentContext = {}): WebhookEmitInput {
  return {
    organizationId: payment.organizationId,
    type: "payment.confirmed",
    key: payment.id,
    data: {
      paymentId: payment.id,
      checkoutSessionId: payment.checkoutSessionId,
      customerId: payment.customerId,
      ...(context.customerEmail ? { customerEmail: context.customerEmail } : {}),
      productIds: [...(context.productIds ?? [])],
      amount: payment.amount.amount,
      currency: payment.amount.currency,
      network: payment.network,
      txHash: payment.txHash ?? null,
      confirmedAt: payment.confirmedAt ?? payment.createdAt,
      ...(context.buyer && Object.keys(context.buyer).length > 0 ? { buyer: { ...context.buyer } } : {}),
    },
  };
}

function subscriptionBase(sub: OnchainSubscription): Record<string, unknown> {
  return {
    subscriptionId: sub.subscriptionId ?? null,
    onchainSubscriptionId: sub.id,
    customerId: sub.customerId,
    ...(sub.customerEmail ? { customerEmail: sub.customerEmail } : {}),
    productId: sub.productId,
    priceId: sub.priceId,
    network: sub.network,
    method: sub.method,
    amountPerPeriod: sub.amountDisplay,
    currency: "USDC",
  };
}

export function subscriptionChargedWebhook(
  sub: OnchainSubscription,
  charge: OnchainCharge,
  period: { start: Date; end: Date },
  paymentId: string | null,
): WebhookEmitInput {
  return {
    organizationId: sub.organizationId,
    type: "subscription.charged",
    key: charge.id,
    data: {
      ...subscriptionBase(sub),
      chargeId: charge.id,
      periodIndex: charge.periodIndex,
      amount: fromBaseUnits(BigInt(charge.amount)),
      txHash: charge.txHash ?? null,
      paymentId,
      currentPeriodStart: period.start.toISOString(),
      currentPeriodEnd: period.end.toISOString(),
    },
  };
}

export function subscriptionCanceledWebhook(sub: OnchainSubscription, atPeriodEnd: boolean, by: "merchant" | "buyer"): WebhookEmitInput {
  return {
    organizationId: sub.organizationId,
    type: "subscription.canceled",
    key: `${sub.id}:${atPeriodEnd ? "period_end" : "now"}`,
    data: {
      ...subscriptionBase(sub),
      status: sub.status,
      cancelAtPeriodEnd: atPeriodEnd,
      canceledBy: by,
      canceledAt: sub.canceledAt ?? sub.updatedAt,
    },
  };
}

export interface RefundWebhookInput {
  refundId: string;
  payment: Payment;
  amount: string;
  reason: string;
  txHash: string | null;
  /** operator = sent by the SettleKit operator wallet / escrow; manual = recorded by the seller. */
  source: "operator" | "escrow" | "manual";
}

export function refundSucceededWebhook(input: RefundWebhookInput): WebhookEmitInput {
  return {
    organizationId: input.payment.organizationId,
    type: "refund.succeeded",
    key: input.refundId,
    data: {
      refundId: input.refundId,
      paymentId: input.payment.id,
      customerId: input.payment.customerId,
      amount: input.amount,
      currency: input.payment.amount.currency,
      network: input.payment.network,
      reason: input.reason,
      txHash: input.txHash,
      source: input.source,
    },
  };
}
