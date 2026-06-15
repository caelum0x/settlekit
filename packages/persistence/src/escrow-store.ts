/**
 * Postgres-backed {@link EscrowStore}. Each record's canonical document lives in
 * its table's `metadata.__doc`; typed columns are projected for querying.
 *
 * Sub-records (funding/release/refund/submission/review/dispute) carry no id of
 * their own, so we derive a deterministic per-task id and upsert — matching the
 * single-record-per-task semantics of the in-memory store. `merchant_id` /
 * `buyer_customer_id` project to the seeded defaults (the real ids live in the
 * document); `listTasks` filters unpacked docs by organizationId since the table
 * has no organization column.
 */
import {
  eq,
  type Database,
  escrowTasks,
  escrowFundings,
  escrowReleases,
  escrowRefunds,
  escrowSubmissions,
  escrowReviews,
  escrowDisputes,
} from "@settlekit/database";
import type { EscrowTask } from "@settlekit/common";
import type {
  EscrowStore,
  EscrowFunding,
  EscrowRelease,
  EscrowRefund,
  TaskSubmission,
  TaskReview,
  EscrowDispute,
} from "@settlekit/escrow";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID, DEFAULT_CUSTOMER_ID } from "./seed.js";

export class PgEscrowStore implements EscrowStore {
  constructor(private readonly db: Database) {}

  async saveTask(task: EscrowTask): Promise<void> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      buyerCustomerId: DEFAULT_CUSTOMER_ID,
      title: task.title,
      currency: task.currency,
      amount: task.amount,
      status: task.status,
      metadata: packDoc(task),
    };
    await this.db
      .insert(escrowTasks)
      .values({ id: task.id, ...projection })
      .onConflictDoUpdate({ target: escrowTasks.id, set: projection });
  }

  async findTask(taskId: string): Promise<EscrowTask | undefined> {
    const rows = await this.db
      .select({ metadata: escrowTasks.metadata })
      .from(escrowTasks)
      .where(eq(escrowTasks.id, taskId))
      .limit(1);
    return unpackDoc<EscrowTask>(rows[0]) ?? undefined;
  }

  async listTasks(organizationId: string): Promise<EscrowTask[]> {
    const rows = await this.db.select({ metadata: escrowTasks.metadata }).from(escrowTasks);
    return unpackDocs<EscrowTask>(rows).filter((t) => t.organizationId === organizationId);
  }

  async saveFunding(funding: EscrowFunding): Promise<void> {
    const projection = {
      escrowTaskId: funding.taskId,
      currency: funding.currency,
      amount: funding.amount,
      txHash: funding.fundingTxHash,
      fundedAt: new Date(funding.fundedAt),
      metadata: packDoc(funding),
    };
    await this.db
      .insert(escrowFundings)
      .values({ id: `efund_${funding.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowFundings.id, set: projection });
  }

  async saveRelease(release: EscrowRelease): Promise<void> {
    const projection = {
      escrowTaskId: release.taskId,
      currency: release.currency,
      amount: release.amount,
      txHash: release.releaseTxHash,
      releasedAt: new Date(release.releasedAt),
      metadata: packDoc(release),
    };
    await this.db
      .insert(escrowReleases)
      .values({ id: `erel_${release.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowReleases.id, set: projection });
  }

  async saveRefund(refund: EscrowRefund): Promise<void> {
    const projection = {
      escrowTaskId: refund.taskId,
      currency: refund.currency,
      amount: refund.amount,
      reason: refund.reason,
      refundedAt: new Date(refund.refundedAt),
      metadata: packDoc(refund),
    };
    await this.db
      .insert(escrowRefunds)
      .values({ id: `eref_${refund.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowRefunds.id, set: projection });
  }

  async saveSubmission(submission: TaskSubmission): Promise<void> {
    const projection = {
      escrowTaskId: submission.taskId,
      submittedBy: null,
      notes: submission.content,
      submittedAt: new Date(submission.submittedAt),
      metadata: packDoc(submission),
    };
    await this.db
      .insert(escrowSubmissions)
      .values({ id: `esub_${submission.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowSubmissions.id, set: projection });
  }

  async saveReview(review: TaskReview): Promise<void> {
    const projection = {
      escrowTaskId: review.taskId,
      decision: "approved",
      reviewedAt: new Date(review.approvedAt),
      metadata: packDoc(review),
    };
    await this.db
      .insert(escrowReviews)
      .values({ id: `erev_${review.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowReviews.id, set: projection });
  }

  async saveDispute(dispute: EscrowDispute): Promise<void> {
    const projection = {
      escrowTaskId: dispute.taskId,
      reason: dispute.reason,
      metadata: packDoc(dispute),
    };
    await this.db
      .insert(escrowDisputes)
      .values({ id: `edis_${dispute.taskId}`, ...projection })
      .onConflictDoUpdate({ target: escrowDisputes.id, set: projection });
  }

  async findDispute(taskId: string): Promise<EscrowDispute | undefined> {
    const rows = await this.db
      .select({ metadata: escrowDisputes.metadata })
      .from(escrowDisputes)
      .where(eq(escrowDisputes.escrowTaskId, taskId))
      .limit(1);
    return unpackDoc<EscrowDispute>(rows[0]) ?? undefined;
  }
}
