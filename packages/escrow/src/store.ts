import type { EscrowTask } from "@settlekit/common";
import type {
  EscrowDispute,
  EscrowFunding,
  EscrowRefund,
  EscrowRelease,
  TaskReview,
  TaskSubmission,
} from "./types.js";

/**
 * Persistence boundary for the escrow domain. Implementations own how records
 * are stored (Postgres, KV, etc.); the {@link import("./service.js").EscrowService}
 * depends only on this narrow interface so storage can be swapped without
 * touching domain logic.
 *
 * The task record is the source of truth for state; the event records
 * (funding/release/refund/submission/review/dispute) form an append-style audit
 * trail keyed by task id.
 */
export interface EscrowStore {
  /** Insert or replace a task, keyed by `task.id`. */
  saveTask(task: EscrowTask): Promise<void>;
  /** Find a task by id, or `undefined` if none exists. */
  findTask(taskId: string): Promise<EscrowTask | undefined>;
  /** List all tasks belonging to an organization. */
  listTasks(organizationId: string): Promise<EscrowTask[]>;

  /** Append a funding event. */
  saveFunding(funding: EscrowFunding): Promise<void>;
  /** Append a release event. */
  saveRelease(release: EscrowRelease): Promise<void>;
  /** Append a refund event. */
  saveRefund(refund: EscrowRefund): Promise<void>;
  /** Append a work submission. */
  saveSubmission(submission: TaskSubmission): Promise<void>;
  /** Append a buyer review/approval. */
  saveReview(review: TaskReview): Promise<void>;
  /** Insert or update the dispute for a task (keyed by `dispute.taskId`). */
  saveDispute(dispute: EscrowDispute): Promise<void>;
  /** Find the dispute for a task, or `undefined`. */
  findDispute(taskId: string): Promise<EscrowDispute | undefined>;
}

function cloneTask(task: EscrowTask): EscrowTask {
  return { ...task };
}

/**
 * A real, fully-functional in-memory {@link EscrowStore}.
 *
 * Records are stored and returned as defensive copies so callers can never
 * mutate persisted state, matching the package's immutability guarantees. This
 * is production-correct for single-process / test usage and is the reference
 * implementation of the interface.
 */
export class InMemoryEscrowStore implements EscrowStore {
  private readonly tasks = new Map<string, EscrowTask>();
  private readonly fundings: EscrowFunding[] = [];
  private readonly releases: EscrowRelease[] = [];
  private readonly refunds: EscrowRefund[] = [];
  private readonly submissions: TaskSubmission[] = [];
  private readonly reviews: TaskReview[] = [];
  private readonly disputes = new Map<string, EscrowDispute>();

  async saveTask(task: EscrowTask): Promise<void> {
    this.tasks.set(task.id, cloneTask(task));
  }

  async findTask(taskId: string): Promise<EscrowTask | undefined> {
    const found = this.tasks.get(taskId);
    return found ? cloneTask(found) : undefined;
  }

  async listTasks(organizationId: string): Promise<EscrowTask[]> {
    return [...this.tasks.values()]
      .filter((task) => task.organizationId === organizationId)
      .map(cloneTask);
  }

  async saveFunding(funding: EscrowFunding): Promise<void> {
    this.fundings.push({ ...funding });
  }

  async saveRelease(release: EscrowRelease): Promise<void> {
    this.releases.push({ ...release });
  }

  async saveRefund(refund: EscrowRefund): Promise<void> {
    this.refunds.push({ ...refund });
  }

  async saveSubmission(submission: TaskSubmission): Promise<void> {
    this.submissions.push({ ...submission });
  }

  async saveReview(review: TaskReview): Promise<void> {
    this.reviews.push({ ...review });
  }

  async saveDispute(dispute: EscrowDispute): Promise<void> {
    this.disputes.set(dispute.taskId, { ...dispute });
  }

  async findDispute(taskId: string): Promise<EscrowDispute | undefined> {
    const found = this.disputes.get(taskId);
    return found ? { ...found } : undefined;
  }

  /** Read-only view of recorded funding events (for tests/audit tooling). */
  get fundingEvents(): readonly EscrowFunding[] {
    return this.fundings.map((f) => ({ ...f }));
  }

  /** Read-only view of recorded release events (for tests/audit tooling). */
  get releaseEvents(): readonly EscrowRelease[] {
    return this.releases.map((r) => ({ ...r }));
  }

  /** Read-only view of recorded refund events (for tests/audit tooling). */
  get refundEvents(): readonly EscrowRefund[] {
    return this.refunds.map((r) => ({ ...r }));
  }

  /** Read-only view of recorded submissions (for tests/audit tooling). */
  get submissionEvents(): readonly TaskSubmission[] {
    return this.submissions.map((s) => ({ ...s }));
  }

  /** Read-only view of recorded reviews (for tests/audit tooling). */
  get reviewEvents(): readonly TaskReview[] {
    return this.reviews.map((r) => ({ ...r }));
  }
}
