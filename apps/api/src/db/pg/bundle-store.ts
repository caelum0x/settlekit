/**
 * Postgres-backed {@link BundleStore}.
 * Canonical Bundle in `metadata.__doc`; columns projected for querying.
 * The `bundles` table has no organization column, so the `organizationId`
 * filter is applied against the canonical document.
 */
import { eq, type Database, bundles } from "@settlekit/database";
import type { Bundle } from "@settlekit/common";
import type { BundleStore, ListBundlesOptions } from "@settlekit/bundles";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgBundleStore implements BundleStore {
  constructor(private readonly db: Database) {}

  async save(entity: Bundle): Promise<Bundle> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: entity.name,
      description: entity.description ?? null,
      currency: entity.price.currency,
      totalAmount: entity.price.amount,
      status: entity.status,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(bundles)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: bundles.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Bundle | null> {
    const rows = await this.db
      .select({ metadata: bundles.metadata })
      .from(bundles)
      .where(eq(bundles.id, id))
      .limit(1);
    return unpackDoc<Bundle>(rows[0]);
  }

  async list(options?: ListBundlesOptions): Promise<Bundle[]> {
    const rows = await this.db
      .select({ metadata: bundles.metadata })
      .from(bundles);
    let all = unpackDocs<Bundle>(rows);
    if (options?.organizationId) {
      all = all.filter((b) => b.organizationId === options.organizationId);
    }
    if (options?.merchantId) {
      all = all.filter((b) => b.merchantId === options.merchantId);
    }
    if (options?.activeOnly) {
      all = all.filter((b) => b.status === "active");
    }
    return all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(bundles)
      .where(eq(bundles.id, id))
      .returning({ id: bundles.id });
    return res.length > 0;
  }
}
