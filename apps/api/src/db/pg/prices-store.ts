/**
 * Postgres-backed {@link EntityStore} for prices.
 * Canonical Price in `metadata.__doc`; typed columns projected for querying.
 */
import { eq, type Database, prices } from "@settlekit/database";
import type { Price } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";

export class PgPriceStore implements EntityStore<Price> {
  constructor(private readonly db: Database) {}

  async save(entity: Price): Promise<Price> {
    const projection = {
      productId: entity.productId,
      currency: entity.currency,
      unitAmount: entity.unitAmount ?? entity.amount,
      interval: entity.interval,
      active: entity.active,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(prices)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: prices.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Price | null> {
    const rows = await this.db
      .select({ metadata: prices.metadata })
      .from(prices)
      .where(eq(prices.id, id))
      .limit(1);
    return unpackDoc<Price>(rows[0]);
  }

  async list(predicate?: (entity: Price) => boolean): Promise<Price[]> {
    const rows = await this.db.select({ metadata: prices.metadata }).from(prices);
    const all = unpackDocs<Price>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(prices)
      .where(eq(prices.id, id))
      .returning({ id: prices.id });
    return res.length > 0;
  }
}
