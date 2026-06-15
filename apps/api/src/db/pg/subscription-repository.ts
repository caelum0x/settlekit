/**
 * Postgres-backed {@link SubscriptionRepository}.
 * Canonical Subscription in `metadata.__doc`; columns projected for querying.
 */
import { eq, type Database, subscriptions } from "@settlekit/database";
import type { Subscription } from "@settlekit/common";
import type { SubscriptionRepository } from "@settlekit/payments";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgSubscriptionRepository implements SubscriptionRepository {
  constructor(private readonly db: Database) {}

  async save(entity: Subscription): Promise<Subscription> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: entity.customerId,
      priceId: entity.priceId,
      status: entity.status,
      currentPeriodStart: new Date(entity.currentPeriodStart),
      currentPeriodEnd: new Date(entity.currentPeriodEnd),
      cancelAtPeriodEnd: entity.cancelAtPeriodEnd,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(subscriptions)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: subscriptions.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Subscription | null> {
    const rows = await this.db
      .select({ metadata: subscriptions.metadata })
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    return unpackDoc<Subscription>(rows[0]);
  }

  async findByCustomerId(customerId: string): Promise<Subscription[]> {
    const rows = await this.db
      .select({ metadata: subscriptions.metadata })
      .from(subscriptions)
      .where(eq(subscriptions.customerId, customerId));
    return unpackDocs<Subscription>(rows);
  }
}
