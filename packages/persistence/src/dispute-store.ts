/**
 * Postgres-backed {@link DisputeStore}. The canonical {@link Dispute} (evidence,
 * timestamps) lives in `metadata.__doc`; payment/customer/status columns are
 * projected for the by-payment / by-customer / open queries. "Open" means a
 * dispute still awaiting resolution (`open` or `under_review`).
 */
import { eq, inArray, type Database, disputes } from "@settlekit/database";
import type { Dispute, DisputeStore } from "@settlekit/disputes";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** Convert an optional ISO timestamp to a Date for a `timestamptz` column. */
function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

export class PgDisputeStore implements DisputeStore {
  constructor(private readonly db: Database) {}

  async save(dispute: Dispute): Promise<Dispute> {
    const projection = {
      paymentId: dispute.paymentId,
      customerId: dispute.customerId,
      reason: dispute.reason,
      status: dispute.status,
      resolvedAt: toDate(dispute.resolvedAt),
      metadata: packDoc(dispute),
    };
    await this.db
      .insert(disputes)
      .values({ id: dispute.id, ...projection })
      .onConflictDoUpdate({ target: disputes.id, set: projection });
    return dispute;
  }

  async findById(id: string): Promise<Dispute | undefined> {
    const rows = await this.db
      .select({ metadata: disputes.metadata })
      .from(disputes)
      .where(eq(disputes.id, id))
      .limit(1);
    return unpackDoc<Dispute>(rows[0]) ?? undefined;
  }

  async listByPayment(paymentId: string): Promise<Dispute[]> {
    const rows = await this.db
      .select({ metadata: disputes.metadata })
      .from(disputes)
      .where(eq(disputes.paymentId, paymentId));
    return unpackDocs<Dispute>(rows);
  }

  async listByCustomer(customerId: string): Promise<Dispute[]> {
    const rows = await this.db
      .select({ metadata: disputes.metadata })
      .from(disputes)
      .where(eq(disputes.customerId, customerId));
    return unpackDocs<Dispute>(rows);
  }

  async listOpen(): Promise<Dispute[]> {
    const rows = await this.db
      .select({ metadata: disputes.metadata })
      .from(disputes)
      .where(inArray(disputes.status, ["open", "under_review"]));
    return unpackDocs<Dispute>(rows);
  }

  async listAll(): Promise<Dispute[]> {
    const rows = await this.db.select({ metadata: disputes.metadata }).from(disputes);
    return unpackDocs<Dispute>(rows);
  }
}
