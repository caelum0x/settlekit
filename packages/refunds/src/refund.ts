import type { Money, Payment, Result, SettleKitError } from "@settlekit/common";
import {
  addMoney,
  compareMoney,
  conflict,
  err,
  isZero,
  money,
  ok,
  subtractMoney,
  toIso,
  validationError,
} from "@settlekit/common";
import type { Refund, RefundReason } from "./types.js";

/** Input required to create a refund against a payment. */
export interface CreateRefundInput {
  payment: Payment;
  customerId: string;
  /** Decimal major-unit amount string, e.g. "10.5". */
  amount: string;
  reason: RefundReason;
  /** Refunds already recorded against this payment (pending or succeeded). */
  existingRefunds?: readonly Refund[];
}

/** Sum the amounts of refunds that still hold value (not failed). */
export function refundedTotal(refunds: readonly Refund[], currency: Money["currency"] = "USDC"): Money {
  return refunds
    .filter((r) => r.status !== "failed")
    .reduce((sum, r) => addMoney(sum, r.amount), money("0", currency));
}

/** The amount still refundable on a payment given prior refunds. */
export function refundableRemaining(payment: Payment, existingRefunds: readonly Refund[] = []): Money {
  return subtractMoney(payment.amount, refundedTotal(existingRefunds, payment.amount.currency));
}

/**
 * Create a pending refund. Validates that the payment is confirmed and that
 * the requested amount is positive and does not push the cumulative refunded
 * total past the original payment amount.
 */
export function createRefund(
  input: CreateRefundInput,
  generate: () => string,
  now: Date = new Date(),
): Result<Refund, SettleKitError> {
  const { payment, customerId, reason } = input;
  const existing = input.existingRefunds ?? [];

  if (payment.status !== "confirmed" && payment.status !== "refunded") {
    return err(conflict(`cannot refund a payment with status ${payment.status}`, { paymentId: payment.id }));
  }

  let amount: Money;
  try {
    amount = money(input.amount, payment.amount.currency);
  } catch (cause) {
    return err(validationError(`invalid refund amount ${JSON.stringify(input.amount)}`, { cause: String(cause) }));
  }

  if (compareMoney(amount, money("0", amount.currency)) <= 0) {
    return err(validationError("refund amount must be positive", { amount: amount.amount }));
  }

  const remaining = refundableRemaining(payment, existing);
  if (compareMoney(amount, remaining) > 0) {
    return err(
      validationError("refund amount exceeds refundable remaining", {
        requested: amount.amount,
        remaining: remaining.amount,
        paymentId: payment.id,
      }),
    );
  }

  const timestamp = toIso(now);
  const refund: Refund = {
    id: generate(),
    paymentId: payment.id,
    customerId,
    amount,
    reason,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return ok(refund);
}

/** Returns true when this refund settles the full original payment. */
export function isFullRefund(refund: Refund, payment: Payment): boolean {
  return compareMoney(refund.amount, payment.amount) === 0;
}

/** Returns true when a refund leaves part of the payment intact. */
export function isPartialRefund(refund: Refund, payment: Payment): boolean {
  return !isFullRefund(refund, payment) && !isZero(refund.amount);
}

/** Transition a pending refund to succeeded (immutable copy). */
export function markSucceeded(refund: Refund, now: Date = new Date()): Result<Refund, SettleKitError> {
  if (refund.status !== "pending") {
    return err(conflict(`cannot succeed a refund in status ${refund.status}`, { refundId: refund.id }));
  }
  return ok({ ...refund, status: "succeeded", failureReason: undefined, updatedAt: toIso(now) });
}

/** Transition a pending refund to failed (immutable copy). */
export function markFailed(refund: Refund, reason: string, now: Date = new Date()): Result<Refund, SettleKitError> {
  if (refund.status !== "pending") {
    return err(conflict(`cannot fail a refund in status ${refund.status}`, { refundId: refund.id }));
  }
  return ok({ ...refund, status: "failed", failureReason: reason, updatedAt: toIso(now) });
}
