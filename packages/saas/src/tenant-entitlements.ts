/**
 * Build a `saas_feature` Entitlement from a plan purchase (plan §14, §20).
 *
 * The core abstraction: a payment/subscription grants an Entitlement, and the
 * Entitlement carries the plan's feature flags + limits and seat allotment.
 */
import { generateId } from "@settlekit/common";
import type { Entitlement, IsoTimestamp } from "@settlekit/common";
import type { SaasPlan } from "./saas-plan.js";

/** Input describing the purchase that grants a tenant entitlement. */
export interface TenantEntitlementInput {
  organizationId: string;
  customerId: string;
  plan: SaasPlan;
  /** What granted this entitlement (a subscription, normally). */
  grantedBy: { type: "payment" | "subscription" | "bundle" | "manual"; id: string };
  /** When the entitlement should expire (e.g. current period end). */
  expiresAt?: IsoTimestamp;
  now?: Date;
}

/**
 * Construct an active `saas_feature` {@link Entitlement} for a plan purchase.
 *
 * The plan's `features` map is copied into the entitlement, and the plan's
 * `seats` becomes the entitlement's seat allotment. The result is `pending`-free
 * and `active` immediately; lifecycle transitions are handled elsewhere
 * (see grace-periods).
 */
export function tenantEntitlement(input: TenantEntitlementInput): Entitlement {
  const now = input.now ?? new Date();
  const iso = now.toISOString();
  return {
    id: generateId("entitlement"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.plan.productId,
    grantedBy: { ...input.grantedBy },
    entitlementType: "saas_feature",
    status: "active",
    features: { ...input.plan.features },
    seats: input.plan.seats,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    createdAt: iso,
    updatedAt: iso,
  };
}
