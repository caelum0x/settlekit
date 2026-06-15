/**
 * Postgres-backed {@link EntityStore} for customers.
 * Canonical Customer in `metadata.__doc`; typed columns projected for querying.
 *
 * The Customer domain type carries `organizationId` (not `merchantId`), but the
 * `customers` table has a NOT NULL `merchant_id` FK — so we project
 * `entity.merchantId` when present and fall back to {@link DEFAULT_MERCHANT_ID}.
 */
import { eq, type Database, customers } from "@settlekit/database";
import type { Customer } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgCustomerStore implements EntityStore<Customer> {
  constructor(private readonly db: Database) {}

  async save(entity: Customer): Promise<Customer> {
    const merchantId =
      (entity as { merchantId?: string }).merchantId || DEFAULT_MERCHANT_ID;
    const projection = {
      merchantId,
      email: entity.email,
      name: entity.name ?? null,
      walletAddress: entity.walletAddress ?? null,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(customers)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: customers.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Customer | null> {
    const rows = await this.db
      .select({ metadata: customers.metadata })
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);
    return unpackDoc<Customer>(rows[0]);
  }

  async list(predicate?: (entity: Customer) => boolean): Promise<Customer[]> {
    const rows = await this.db.select({ metadata: customers.metadata }).from(customers);
    const all = unpackDocs<Customer>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(customers)
      .where(eq(customers.id, id))
      .returning({ id: customers.id });
    return res.length > 0;
  }
}
