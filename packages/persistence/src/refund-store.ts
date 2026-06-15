/**
 * Postgres-backed {@link RefundStore}. The canonical {@link Refund} lives in
 * `metadata.__doc`; typed columns (payment/customer/amount/status) are projected
 * for the by-payment / by-customer / by-status queries.
 */
import { eq, type Database, refunds } from "@settlekit/database";
import type { Refund, RefundStore } from "@settlekit/refunds";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgRefundStore implements RefundStore {
  constructor(private readonly db: Database) {}

  async save(refund: Refund): Promise<Refund> {
    const projection = {
      paymentId: refund.paymentId,
      customerId: refund.customerId,
      currency: refund.amount.currency,
      amount: refund.amount.amount,
      reason: refund.reason,
      status: refund.status,
      failureReason: refund.failureReason ?? null,
      metadata: packDoc(refund),
    };
    await this.db
      .insert(refunds)
      .values({ id: refund.id, ...projection })
      .onConflictDoUpdate({ target: refunds.id, set: projection });
    return refund;
  }

  async findById(id: string): Promise<Refund | undefined> {
    const rows = await this.db
      .select({ metadata: refunds.metadata })
      .from(refunds)
      .where(eq(refunds.id, id))
      .limit(1);
    return unpackDoc<Refund>(rows[0]) ?? undefined;
  }

  async listByPayment(paymentId: string): Promise<Refund[]> {
    const rows = await this.db
      .select({ metadata: refunds.metadata })
      .from(refunds)
      .where(eq(refunds.paymentId, paymentId));
    return unpackDocs<Refund>(rows);
  }

  async listByCustomer(customerId: string): Promise<Refund[]> {
    const rows = await this.db
      .select({ metadata: refunds.metadata })
      .from(refunds)
      .where(eq(refunds.customerId, customerId));
    return unpackDocs<Refund>(rows);
  }

  async listAll(): Promise<Refund[]> {
    const rows = await this.db.select({ metadata: refunds.metadata }).from(refunds);
    return unpackDocs<Refund>(rows);
  }
}
