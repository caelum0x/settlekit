import type { EscrowTask } from "@settlekit/common";
import { generateId, normalizeAmount, toIso, validationError } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";
import type { CreateEscrowTaskInput } from "./types.js";

/**
 * Create a new escrow task in the "created" state (plan §12).
 *
 * Validates the boundary input (title, buyer, organization, and a positive
 * amount are required) and returns a fresh, immutable {@link EscrowTask}. The
 * amount is normalized to a canonical decimal string via `normalizeAmount` so
 * downstream comparisons are stable. The input is never mutated.
 */
export function createEscrowTask(
  input: CreateEscrowTaskInput,
  now: Date = new Date(),
): EscrowTask {
  const title = input.title.trim();
  if (title.length === 0) {
    throw validationError("Escrow task title is required.");
  }
  if (input.buyerCustomerId.trim().length === 0) {
    throw validationError("Escrow task buyerCustomerId is required.");
  }
  if (input.organizationId.trim().length === 0) {
    throw validationError("Escrow task organizationId is required.");
  }

  const amount = normalizeAmount(input.amount);
  if (Number(amount) <= 0) {
    throw validationError("Escrow task amount must be greater than zero.", {
      amount: input.amount,
    });
  }

  return {
    id: generateId("escrowTask"),
    organizationId: input.organizationId,
    buyerCustomerId: input.buyerCustomerId,
    title,
    description: input.description,
    amount,
    currency: input.currency ?? "USDC",
    status: "created",
    createdAt: toIso(now),
  };
}

/**
 * Assign a worker to a funded task: transition "funded" -> "assigned" and
 * record the worker (plan §12). Throws `conflict` if the task is not funded and
 * `validation_error` if the worker id is missing.
 *
 * Returns a NEW immutable task; the input is never mutated.
 */
export function assignWorkerToTask(task: EscrowTask, workerCustomerId: string): EscrowTask {
  const workerId = workerCustomerId.trim();
  if (workerId.length === 0) {
    throw validationError("workerCustomerId is required to assign an escrow task.");
  }
  const status = nextEscrowStatus(task.status, "assign");
  return { ...task, status, workerCustomerId: workerId };
}
