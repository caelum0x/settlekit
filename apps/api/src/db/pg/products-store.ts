/**
 * Postgres-backed {@link EntityStore} for products (reference EntityStore adapter).
 * The canonical Product lives in `metadata.__doc`; typed columns are projected
 * for querying. See ../codec.ts for the document-projection rationale.
 */
import { eq, type Database, products } from "@settlekit/database";
import type { Product } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgProductStore implements EntityStore<Product> {
  constructor(private readonly db: Database) {}

  async save(entity: Product): Promise<Product> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: entity.name,
      description: entity.description ?? null,
      type: entity.type,
      status: entity.status,
      deliveryMode: entity.deliveryMode,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(products)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: products.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Product | null> {
    const rows = await this.db
      .select({ metadata: products.metadata })
      .from(products)
      .where(eq(products.id, id))
      .limit(1);
    return unpackDoc<Product>(rows[0]);
  }

  async list(predicate?: (entity: Product) => boolean): Promise<Product[]> {
    const rows = await this.db.select({ metadata: products.metadata }).from(products);
    const all = unpackDocs<Product>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(products)
      .where(eq(products.id, id))
      .returning({ id: products.id });
    return res.length > 0;
  }
}
