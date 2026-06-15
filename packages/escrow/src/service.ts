import type { EscrowTask } from "@settlekit/common";
import { notFound } from "@settlekit/common";
import { assignWorkerToTask, createEscrowTask } from "./escrow-task.js";
import { fundEscrowTask } from "./escrow-funding.js";
import { submitEscrowWork } from "./task-submissions.js";
import { approveEscrowWork } from "./task-review.js";
import { releaseEscrow } from "./escrow-release.js";
import { refundEscrow } from "./escrow-refund.js";
import { openEscrowDispute, resolveEscrowDispute } from "./escrow-disputes.js";
import type { EscrowStore } from "./store.js";
import type { CreateEscrowTaskInput, DisputeOutcome } from "./types.js";

/**
 * High-level escrow service (plan §12, §24). Wires the pure, immutable domain
 * transition functions to an {@link EscrowStore}: every transition loads the
 * current task, applies the guarded transition, then persists the new task and
 * its corresponding audit event. The store is always the source of truth.
 *
 * Illegal transitions are rejected at the domain layer with a `conflict`
 * (HTTP 409) error; unknown task ids raise `not_found` (HTTP 404).
 */
export class EscrowService {
  constructor(private readonly store: EscrowStore) {}

  /** Create a task in the "created" state and persist it. */
  async createTask(input: CreateEscrowTaskInput, now: Date = new Date()): Promise<EscrowTask> {
    const task = createEscrowTask(input, now);
    await this.store.saveTask(task);
    return task;
  }

  /** Fund a task ("created" -> "funded") and record the funding event. */
  async fundTask(taskId: string, fundingTxHash: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: funded, funding } = fundEscrowTask(task, fundingTxHash, now);
    await this.store.saveTask(funded);
    await this.store.saveFunding(funding);
    return funded;
  }

  /** Assign a worker ("funded" -> "assigned") and persist. */
  async assignWorker(taskId: string, workerCustomerId: string): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const assigned = assignWorkerToTask(task, workerCustomerId);
    await this.store.saveTask(assigned);
    return assigned;
  }

  /** Submit work ("assigned" -> "submitted") and record the submission. */
  async submitWork(taskId: string, content: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: submitted, submission } = submitEscrowWork(task, content, now);
    await this.store.saveTask(submitted);
    await this.store.saveSubmission(submission);
    return submitted;
  }

  /** Approve submitted work ("submitted" -> "approved") and record the review. */
  async approve(taskId: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: approved, review } = approveEscrowWork(task, now);
    await this.store.saveTask(approved);
    await this.store.saveReview(review);
    return approved;
  }

  /** Release funds ("approved" -> "released") and record the release event. */
  async release(taskId: string, releaseTxHash: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: released, release } = releaseEscrow(task, releaseTxHash, { now });
    await this.store.saveTask(released);
    await this.store.saveRelease(release);
    return released;
  }

  /** Refund the buyer (pre-release states -> "refunded") and record it. */
  async refund(taskId: string, reason: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: refunded, refund } = refundEscrow(task, reason, { now });
    await this.store.saveTask(refunded);
    await this.store.saveRefund(refund);
    return refunded;
  }

  /** Open a dispute (-> "disputed") and record it. */
  async openDispute(taskId: string, reason: string, now: Date = new Date()): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const { task: disputed, dispute } = openEscrowDispute(task, reason, now);
    await this.store.saveTask(disputed);
    await this.store.saveDispute(dispute);
    return disputed;
  }

  /**
   * Resolve an open dispute ("disputed" -> "released" | "refunded"), persist the
   * resulting task and audit event, and stamp the dispute as resolved.
   *
   * For `outcome: "release"` provide `releaseTxHash`; for `outcome: "refund"`
   * provide `reason`.
   */
  async resolveDispute(
    taskId: string,
    args:
      | { outcome: Extract<DisputeOutcome, "release">; releaseTxHash: string; now?: Date }
      | { outcome: Extract<DisputeOutcome, "refund">; reason: string; now?: Date },
  ): Promise<EscrowTask> {
    const task = await this.requireTask(taskId);
    const now = args.now ?? new Date();
    const result = resolveEscrowDispute(task, args);
    await this.store.saveTask(result.task);

    if (args.outcome === "release" && "release" in result) {
      await this.store.saveRelease(result.release);
    } else if (args.outcome === "refund" && "refund" in result) {
      await this.store.saveRefund(result.refund);
    }

    const existingDispute = await this.store.findDispute(taskId);
    if (existingDispute) {
      await this.store.saveDispute({
        ...existingDispute,
        outcome: args.outcome,
        resolvedAt: now.toISOString(),
      });
    }

    return result.task;
  }

  /** Fetch a task or `undefined` if it does not exist. */
  async getTask(taskId: string): Promise<EscrowTask | undefined> {
    return this.store.findTask(taskId);
  }

  /** List all tasks for an organization. */
  async listTasks(organizationId: string): Promise<EscrowTask[]> {
    return this.store.listTasks(organizationId);
  }

  private async requireTask(taskId: string): Promise<EscrowTask> {
    const task = await this.store.findTask(taskId);
    if (!task) {
      throw notFound(`Escrow task "${taskId}" not found.`, { taskId });
    }
    return task;
  }
}
