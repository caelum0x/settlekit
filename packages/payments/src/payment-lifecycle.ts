/**
 * Payment lifecycle state machine (plan §15, Phase 1).
 *
 * Status flow:
 *   pending --confirm(>=minConfirmations)--> confirmed
 *   pending --fail--> failed
 *   confirmed --refund--> refunded
 *
 * Every transition returns a NEW immutable Payment; inputs are never mutated.
 */

import {
  generateId,
  money,
  toIso,
  validationError,
  conflict,
  type Money,
  type Payment,
  type PaymentNetwork,
} from "@settlekit/common";

/**
 * Default minimum confirmations required before a payment is considered
 * settled. Chosen conservatively for fast L2 networks; callers may override
 * per-network.
 */
export const DEFAULT_MIN_CONFIRMATIONS = 1;

export interface RecordPendingPaymentInput {
  readonly organizationId: string;
  readonly checkoutSessionId: string;
  readonly customerId: string;
  readonly amount: Money;
  readonly network: PaymentNetwork;
  /** Optional tx hash if already observed in the mempool. */
  readonly txHash?: string;
}

/**
 * Record a freshly-observed payment in the "pending" state. The payment is not
 * yet settled — it must accumulate confirmations before being confirmed.
 */
export function recordPendingPayment(
  input: RecordPendingPaymentInput,
  now: Date = new Date(),
): Payment {
  return {
    id: generateId("payment"),
    organizationId: input.organizationId,
    checkoutSessionId: input.checkoutSessionId,
    customerId: input.customerId,
    amount: money(input.amount.amount, input.amount.currency),
    network: input.network,
    ...(input.txHash !== undefined ? { txHash: input.txHash } : {}),
    confirmations: 0,
    status: "pending",
    createdAt: toIso(now),
  };
}

/**
 * Confirm a pending payment once it has reached the required confirmation
 * depth. Enforces the min-confirmations rule: if `confirmations` is below
 * `minConfirmations`, the call fails with a validation error and the payment
 * stays pending (the returned error lets the caller retry later).
 *
 * Returns a NEW confirmed Payment carrying the observed txHash + confirmations.
 */
export function confirmPayment(
  payment: Payment,
  txHash: string,
  confirmations: number,
  minConfirmations: number = DEFAULT_MIN_CONFIRMATIONS,
  now: Date = new Date(),
): Payment {
  if (payment.status === "confirmed") {
    // Idempotent: re-confirming an already confirmed tx is a no-op when the
    // tx hash matches; mismatches are a conflict (double-spend / wrong tx).
    if (payment.txHash === txHash) {
      return payment;
    }
    throw conflict(
      `Payment ${payment.id} already confirmed with a different txHash`,
      { paymentId: payment.id, existingTxHash: payment.txHash, newTxHash: txHash },
    );
  }
  if (payment.status !== "pending") {
    throw conflict(
      `Cannot confirm a ${payment.status} payment`,
      { paymentId: payment.id, status: payment.status },
    );
  }
  if (txHash.trim().length === 0) {
    throw validationError("confirmPayment requires a non-empty txHash", {
      paymentId: payment.id,
    });
  }
  if (!Number.isInteger(minConfirmations) || minConfirmations < 1) {
    throw validationError(
      `minConfirmations must be a positive integer, got ${minConfirmations}`,
    );
  }
  if (!Number.isInteger(confirmations) || confirmations < 0) {
    throw validationError(
      `confirmations must be a non-negative integer, got ${confirmations}`,
      { paymentId: payment.id },
    );
  }
  if (confirmations < minConfirmations) {
    throw validationError(
      `Payment has ${confirmations} confirmations; ${minConfirmations} required`,
      {
        paymentId: payment.id,
        confirmations,
        minConfirmations,
      },
    );
  }

  return {
    ...payment,
    txHash,
    confirmations,
    status: "confirmed",
    confirmedAt: toIso(now),
  };
}

/**
 * Mark a pending payment as failed (dropped tx, underpayment, expiry).
 * Returns a NEW failed Payment. Confirmed/refunded payments cannot fail.
 */
export function failPayment(payment: Payment): Payment {
  if (payment.status === "failed") {
    return payment;
  }
  if (payment.status !== "pending") {
    throw conflict(
      `Cannot fail a ${payment.status} payment`,
      { paymentId: payment.id, status: payment.status },
    );
  }
  return { ...payment, status: "failed" };
}

/**
 * Refund a confirmed payment. Returns a NEW refunded Payment.
 *
 * Only confirmed payments may be refunded; pending/failed payments have no
 * settled funds to return, and an already-refunded payment is returned as-is
 * (idempotent).
 */
export function refundPayment(payment: Payment): Payment {
  if (payment.status === "refunded") {
    return payment;
  }
  if (payment.status !== "confirmed") {
    throw conflict(
      `Only confirmed payments can be refunded; payment is ${payment.status}`,
      { paymentId: payment.id, status: payment.status },
    );
  }
  return { ...payment, status: "refunded" };
}

/** True once the payment has reached a terminal (non-retryable) state. */
export function isTerminalPayment(payment: Payment): boolean {
  return payment.status === "failed" || payment.status === "refunded";
}
