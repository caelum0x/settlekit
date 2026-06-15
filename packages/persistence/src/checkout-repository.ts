/**
 * Postgres-backed {@link CheckoutRepository} (reference packaged-interface adapter).
 * Canonical CheckoutSession in `metadata.__doc`; columns projected for querying.
 */
import { eq, type Database, checkoutSessions } from "@settlekit/database";
import type { CheckoutSession } from "@settlekit/common";
import type { CheckoutRepository } from "@settlekit/payments";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export class PgCheckoutRepository implements CheckoutRepository {
  constructor(private readonly db: Database) {}

  async save(entity: CheckoutSession): Promise<CheckoutSession> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: entity.customerId ?? null,
      status: entity.status,
      currency: entity.amount.currency,
      amountTotal: entity.amount.amount,
      lineItems: entity.lineItems.map((li) => ({
        priceId: li.priceId,
        quantity: li.quantity,
        amount: entity.amount.amount,
      })),
      successUrl: entity.successUrl ?? null,
      cancelUrl: entity.cancelUrl ?? null,
      expiresAt: entity.expiresAt ? new Date(entity.expiresAt) : null,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(checkoutSessions)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: checkoutSessions.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<CheckoutSession | null> {
    const rows = await this.db
      .select({ metadata: checkoutSessions.metadata })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.id, id))
      .limit(1);
    return unpackDoc<CheckoutSession>(rows[0]);
  }

  async findByCustomerId(customerId: string): Promise<CheckoutSession[]> {
    const rows = await this.db
      .select({ metadata: checkoutSessions.metadata })
      .from(checkoutSessions)
      .where(eq(checkoutSessions.customerId, customerId));
    return unpackDocs<CheckoutSession>(rows);
  }
}
