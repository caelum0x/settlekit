import type { EscrowTask } from "@settlekit/common";
import { conflict, toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { TaskSubmission } from "./types.js";

/** Result of submitting work: the new task plus the recorded submission. */
export interface SubmitResult {
  task: EscrowTask;
  submission: TaskSubmission;
}

/**
 * Submit work for an assigned task: transition "assigned" -> "submitted" and
 * record the submission (plan §12). The submission is attributed to the task's
 * assigned worker. Throws `conflict` if the task is not in the "assigned" state
 * or has no assigned worker, and `validation_error` if content is empty.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function submitEscrowWork(
  task: EscrowTask,
  content: string,
  now: Date = new Date(),
): SubmitResult {
  const body = content.trim();
  if (body.length === 0) {
    throw validationError("Submission content is required.");
  }
  if (!task.workerCustomerId) {
    throw conflict("Cannot submit work for a task with no assigned worker.", {
      taskId: task.id,
    });
  }

  const status = nextEscrowStatus(task.status, "submit");

  return {
    task: { ...task, status },
    submission: {
      taskId: task.id,
      workerCustomerId: task.workerCustomerId,
      content: body,
      submittedAt: toIso(now),
    },
  };
}
