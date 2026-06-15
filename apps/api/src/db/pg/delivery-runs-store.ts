/**
 * Postgres-backed {@link EntityStore} for delivery runs.
 * Canonical DeliveryRun in `metadata.__doc`; typed columns projected for querying.
 *
 * The DeliveryRun domain type carries `organizationId` (not `merchantId`), but
 * the `delivery_runs` table has a NOT NULL `merchant_id` FK — so we project
 * {@link DEFAULT_MERCHANT_ID}.
 */
import { eq, type Database, deliveryRuns } from "@settlekit/database";
import type { DeliveryRun } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgDeliveryRunStore implements EntityStore<DeliveryRun> {
  constructor(private readonly db: Database) {}

  async save(entity: DeliveryRun): Promise<DeliveryRun> {
    const projection = {
      deliveryPlanId: entity.deliveryPlanId,
      merchantId: DEFAULT_MERCHANT_ID,
      paymentId: entity.paymentId ?? null,
      status: entity.status,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(deliveryRuns)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: deliveryRuns.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<DeliveryRun | null> {
    const rows = await this.db
      .select({ metadata: deliveryRuns.metadata })
      .from(deliveryRuns)
      .where(eq(deliveryRuns.id, id))
      .limit(1);
    return unpackDoc<DeliveryRun>(rows[0]);
  }

  async list(predicate?: (entity: DeliveryRun) => boolean): Promise<DeliveryRun[]> {
    const rows = await this.db
      .select({ metadata: deliveryRuns.metadata })
      .from(deliveryRuns);
    const all = unpackDocs<DeliveryRun>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(deliveryRuns)
      .where(eq(deliveryRuns.id, id))
      .returning({ id: deliveryRuns.id });
    return res.length > 0;
  }
}
