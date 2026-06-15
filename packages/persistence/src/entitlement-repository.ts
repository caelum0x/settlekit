/**
 * Postgres-backed {@link EntitlementRepository}.
 * Canonical Entitlement in `metadata.__doc`; columns projected for querying.
 */
import { eq, type Database, entitlements } from "@settlekit/database";
import type { Entitlement } from "@settlekit/common";
import type {
  EntitlementRepository,
  ListByCustomerOptions,
} from "@settlekit/entitlements";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export class PgEntitlementRepository implements EntitlementRepository {
  constructor(private readonly db: Database) {}

  async save(entity: Entitlement): Promise<Entitlement> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      customerId: entity.customerId,
      productId: entity.productId ?? null,
      type: entity.entitlementType,
      status: entity.status,
      expiresAt: entity.expiresAt ? new Date(entity.expiresAt) : null,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(entitlements)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: entitlements.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<Entitlement | null> {
    const rows = await this.db
      .select({ metadata: entitlements.metadata })
      .from(entitlements)
      .where(eq(entitlements.id, id))
      .limit(1);
    return unpackDoc<Entitlement>(rows[0]);
  }

  async findActiveByCustomerProduct(
    customerId: string,
    productId: string,
  ): Promise<Entitlement | null> {
    const rows = await this.db
      .select({ metadata: entitlements.metadata })
      .from(entitlements)
      .where(eq(entitlements.customerId, customerId));
    const all = unpackDocs<Entitlement>(rows);
    const match = all.find(
      (e) => e.productId === productId && e.status === "active",
    );
    return match ?? null;
  }

  async listByCustomer(
    customerId: string,
    options?: ListByCustomerOptions,
  ): Promise<Entitlement[]> {
    const rows = await this.db
      .select({ metadata: entitlements.metadata })
      .from(entitlements)
      .where(eq(entitlements.customerId, customerId));
    let all = unpackDocs<Entitlement>(rows);
    if (options?.activeOnly) {
      all = all.filter((e) => e.status === "active");
    }
    if (options?.productId) {
      all = all.filter((e) => e.productId === options.productId);
    }
    return all;
  }
}
