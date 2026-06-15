import type { EscrowTask } from "@settlekit/common";
import { toIso } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { TaskReview } from "./types.js";

/** Result of approving work: the new task plus the recorded review. */
export interface ApproveResult {
  task: EscrowTask;
  review: TaskReview;
}

/**
 * Approve submitted work: transition "submitted" -> "approved" (plan §12). The
 * approval is attributed to the task's buyer. Approval gates the subsequent
 * `release`. Throws `conflict` if the task is not in the "submitted" state.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function approveEscrowWork(task: EscrowTask, now: Date = new Date()): ApproveResult {
  const status = nextEscrowStatus(task.status, "approve");
  return {
    task: { ...task, status },
    review: {
      taskId: task.id,
      reviewerCustomerId: task.buyerCustomerId,
      approvedAt: toIso(now),
    },
  };
}
