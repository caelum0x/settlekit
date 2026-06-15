import type { EscrowTask } from "@settlekit/common";
import { toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { EscrowFunding } from "./types.js";

/** Result of funding a task: the new task plus the recorded funding event. */
export interface FundResult {
  task: EscrowTask;
  funding: EscrowFunding;
}

/**
 * Fund an escrow task: transition "created" -> "funded" and record the on-chain
 * funding transaction (plan §12). Throws `conflict` if the task is not in a
 * fundable state and `validation_error` if the tx hash is missing.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function fundEscrowTask(
  task: EscrowTask,
  fundingTxHash: string,
  now: Date = new Date(),
): FundResult {
  const txHash = fundingTxHash.trim();
  if (txHash.length === 0) {
    throw validationError("fundingTxHash is required to fund an escrow task.");
  }

  const status = nextEscrowStatus(task.status, "fund");
  const fundedAt = toIso(now);

  return {
    task: { ...task, status, fundingTxHash: txHash },
    funding: {
      taskId: task.id,
      fundingTxHash: txHash,
      amount: task.amount,
      currency: task.currency,
      fundedAt,
    },
  };
}

/** Backwards-compatible helper returning only the updated task. */
export function markEscrowFunded(
  task: EscrowTask,
  fundingTxHash: string,
  now: Date = new Date(),
): EscrowTask {
  return fundEscrowTask(task, fundingTxHash, now).task;
}
