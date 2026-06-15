import type { EscrowTask } from "@settlekit/common";
import { conflict, toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import { refundEscrow, type RefundResult } from "./escrow-refund.js";
import { releaseEscrow, type ReleaseResult } from "./escrow-release.js";
import type { DisputeOutcome, EscrowDispute } from "./types.js";

/** Result of opening a dispute: the new task plus the recorded dispute. */
export interface OpenDisputeResult {
  task: EscrowTask;
  dispute: EscrowDispute;
}

/**
 * Open a dispute against a task: transition to "disputed" (plan §12, §24).
 * Legal from funded/assigned/submitted/approved. Throws `conflict` for an
 * illegal source status and `validation_error` if no reason is given.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function openEscrowDispute(
  task: EscrowTask,
  reason: string,
  now: Date = new Date(),
): OpenDisputeResult {
  const disputeReason = reason.trim();
  if (disputeReason.length === 0) {
    throw validationError("A reason is required to open an escrow dispute.");
  }

  const status = nextEscrowStatus(task.status, "open_dispute");
  return {
    task: { ...task, status },
    dispute: {
      taskId: task.id,
      reason: disputeReason,
      openedAt: toIso(now),
    },
  };
}

/**
 * Resolve an open dispute by either releasing funds to the worker or refunding
 * the buyer (plan §12, §24).
 *
 * For `outcome: "release"` a `releaseTxHash` MUST be supplied; for
 * `outcome: "refund"` a `reason` MUST be supplied. Throws `conflict` if the task
 * is not in the "disputed" state and `validation_error` on missing arguments.
 *
 * Returns a discriminated result carrying the new immutable task and the
 * recorded release or refund event.
 */
export function resolveEscrowDispute(
  task: EscrowTask,
  args:
    | { outcome: Extract<DisputeOutcome, "release">; releaseTxHash: string; now?: Date }
    | { outcome: Extract<DisputeOutcome, "refund">; reason: string; now?: Date },
): ReleaseResult | RefundResult {
  if (task.status !== "disputed") {
    throw conflict(
      `Cannot resolve a dispute for a task in status "${task.status}".`,
      { taskId: task.id, status: task.status },
    );
  }

  if (args.outcome === "release") {
    return releaseEscrow(task, args.releaseTxHash, {
      transition: "resolve_dispute_release",
      now: args.now,
    });
  }

  return refundEscrow(task, args.reason, {
    transition: "resolve_dispute_refund",
    now: args.now,
  });
}
