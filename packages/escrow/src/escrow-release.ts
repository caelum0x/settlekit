import type { EscrowTask } from "@settlekit/common";
import { conflict, toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { EscrowRelease, EscrowTransition } from "./types.js";

/** Result of releasing funds: the new task plus the recorded release. */
export interface ReleaseResult {
  task: EscrowTask;
  release: EscrowRelease;
}

/**
 * Release escrowed funds to the assigned worker and record the on-chain release
 * transaction (plan §12, §24).
 *
 * By default this performs the post-approval "approved" -> "released"
 * transition. Pass `transition: "resolve_dispute_release"` to release as the
 * resolution of a dispute ("disputed" -> "released"). Throws `conflict` for an
 * illegal source status or a task with no assigned worker, and
 * `validation_error` if the tx hash is missing.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function releaseEscrow(
  task: EscrowTask,
  releaseTxHash: string,
  options: { transition?: Extract<EscrowTransition, "release" | "resolve_dispute_release">; now?: Date } = {},
): ReleaseResult {
  const txHash = releaseTxHash.trim();
  if (txHash.length === 0) {
    throw validationError("releaseTxHash is required to release escrow funds.");
  }
  if (!task.workerCustomerId) {
    throw conflict("Cannot release escrow funds for a task with no assigned worker.", {
      taskId: task.id,
    });
  }

  const transition = options.transition ?? "release";
  const status = nextEscrowStatus(task.status, transition);
  const releasedAt = toIso(options.now ?? new Date());

  return {
    task: { ...task, status, releaseTxHash: txHash },
    release: {
      taskId: task.id,
      releaseTxHash: txHash,
      workerCustomerId: task.workerCustomerId,
      amount: task.amount,
      currency: task.currency,
      releasedAt,
    },
  };
}
