import { addDays, generateId, money, type CheckoutSession, type Money, type Payment, type PaymentNetwork } from "@settlekit/common";

export function createCheckoutSession(input: {
  organizationId: string;
  merchantId: string;
  lineItems: CheckoutSession["lineItems"];
  amount: Money;
  payToAddress: string;
  network: PaymentNetwork;
  successUrl?: string;
  cancelUrl?: string;
  collectedFields?: Record<string, string>;
}, now = new Date()): CheckoutSession {
  return {
    id: generateId("checkoutSession"),
    organizationId: input.organizationId,
    merchantId: input.merchantId,
    lineItems: input.lineItems,
    amount: money(input.amount.amount, input.amount.currency),
    status: "open",
    payToAddress: input.payToAddress,
    network: input.network,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    expiresAt: addDays(now, 1).toISOString(),
    collectedFields: input.collectedFields ?? {},
    createdAt: now.toISOString(),
  };
}

export function confirmPayment(input: {
  organizationId: string;
  checkoutSessionId: string;
  customerId: string;
  amount: Money;
  network: PaymentNetwork;
  txHash: string;
  confirmations: number;
}, now = new Date()): Payment {
  return {
    id: generateId("payment"),
    organizationId: input.organizationId,
    checkoutSessionId: input.checkoutSessionId,
    customerId: input.customerId,
    amount: money(input.amount.amount, input.amount.currency),
    network: input.network,
    txHash: input.txHash,
    confirmations: input.confirmations,
    status: "confirmed",
    createdAt: now.toISOString(),
    confirmedAt: now.toISOString(),
  };
}
