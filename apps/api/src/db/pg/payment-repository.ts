/**
 * Postgres-backed {@link PaymentRepository}.
 * Canonical Payment in `metadata.__doc`; columns projected for querying.
 */
import { eq, type Database, payments } from "@settlekit/database";
import type { Payment } from "@settlekit/common";
import type { PaymentRepository } from "@settlekit/payments";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Database) {}

  async save(entity: Payment): Promise<Payment> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: entity.customerId ?? null,
      checkoutSessionId: entity.checkoutSessionId ?? null,
      status: entity.status,
      network: entity.network,
      currency: entity.amount.currency,
      amount: entity.amount.amount,
      txHash: entity.txHash ?? null,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(payments)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: payments.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Payment | null> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.id, id))
      .limit(1);
    return unpackDoc<Payment>(rows[0]);
  }

  async findByCheckoutSessionId(checkoutSessionId: string): Promise<Payment[]> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.checkoutSessionId, checkoutSessionId));
    return unpackDocs<Payment>(rows);
  }

  async findByTxHash(txHash: string): Promise<Payment | null> {
    const rows = await this.db
      .select({ metadata: payments.metadata })
      .from(payments)
      .where(eq(payments.txHash, txHash))
      .limit(1);
    return unpackDoc<Payment>(rows[0]);
  }
}
