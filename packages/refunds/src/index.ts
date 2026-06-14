import type { Money, Payment } from "@settlekit/common";
import { compareMoney, money } from "@settlekit/common";

export interface RefundRequest {
  paymentId: string;
  amount: Money;
  reason: "duplicate" | "fraudulent" | "customer_request" | "delivery_failed";
}

export function createRefundRequest(payment: Payment, amount: string, reason: RefundRequest["reason"]): RefundRequest {
  const refundAmount = money(amount, payment.amount.currency);
  if (compareMoney(refundAmount, payment.amount) === 1) throw new RangeError("refund cannot exceed payment amount");
  return { paymentId: payment.id, amount: refundAmount, reason };
}

export function refundRequiresAccessRevocation(refund: RefundRequest): boolean {
  return refund.reason !== "duplicate";
}
