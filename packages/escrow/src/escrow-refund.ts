import type { EscrowTask } from "@settlekit/common";
import { toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { EscrowRefund, EscrowTransition } from "./types.js";

/** Result of refunding a task: the new task plus the recorded refund. */
export interface RefundResult {
  task: EscrowTask;
  refund: EscrowRefund;
}

/**
 * Refund escrowed funds to the buyer and record the refund (plan §12, §24).
 *
 * By default this performs a direct "refund" transition (legal from
 * created/funded/assigned/submitted). Pass
 * `transition: "resolve_dispute_refund"` to refund as the resolution of a
 * dispute ("disputed" -> "refunded"). Throws `conflict` for an illegal source
 * status and `validation_error` if no reason is given.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function refundEscrow(
  task: EscrowTask,
  reason: string,
  options: { transition?: Extract<EscrowTransition, "refund" | "resolve_dispute_refund">; now?: Date } = {},
): RefundResult {
  const refundReason = reason.trim();
  if (refundReason.length === 0) {
    throw validationError("A reason is required to refund an escrow task.");
  }

  const transition = options.transition ?? "refund";
  const status = nextEscrowStatus(task.status, transition);
  const refundedAt = toIso(options.now ?? new Date());

  return {
    task: { ...task, status },
    refund: {
      taskId: task.id,
      reason: refundReason,
      buyerCustomerId: task.buyerCustomerId,
      amount: task.amount,
      currency: task.currency,
      refundedAt,
    },
  };
}
