/**
 * Postgres-backed {@link PlanStore}.
 * Canonical SaasPlan in `metadata.__doc`; columns projected for querying.
 * The `saas_plans` table has no product column, so `list({ productId })`
 * filters on the canonical document's `productId`.
 */
import { eq, type Database, saasPlans } from "@settlekit/database";
import { ok, type Result, type SettleKitError } from "@settlekit/common";
import type { PlanStore, SaasPlan } from "@settlekit/saas";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgPlanStore implements PlanStore {
  constructor(private readonly db: Database) {}

  async save(plan: SaasPlan): Promise<SaasPlan> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: plan.name,
      code: plan.id,
      status: "active",
      metadata: packDoc(plan),
    };
    await this.db
      .insert(saasPlans)
      .values({ id: plan.id, ...projection })
      .onConflictDoUpdate({ target: saasPlans.id, set: projection });
    return plan;
  }

  async findById(id: string): Promise<SaasPlan | null> {
    const rows = await this.db
      .select({ metadata: saasPlans.metadata })
      .from(saasPlans)
      .where(eq(saasPlans.id, id))
      .limit(1);
    return unpackDoc<SaasPlan>(rows[0]);
  }

  async list(options?: { productId?: string }): Promise<SaasPlan[]> {
    const rows = await this.db
      .select({ metadata: saasPlans.metadata })
      .from(saasPlans);
    const all = unpackDocs<SaasPlan>(rows);
    return options?.productId
      ? all.filter((p) => p.productId === options.productId)
      : all;
  }

  async delete(id: string): Promise<Result<true, SettleKitError>> {
    await this.db.delete(saasPlans).where(eq(saasPlans.id, id));
    return ok(true);
  }
}
