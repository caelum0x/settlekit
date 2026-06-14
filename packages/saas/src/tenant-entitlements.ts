import type { SaasPlan, TenantEntitlements } from "./types.js";

export function entitlementsFromPlan(customerId: string, plan: SaasPlan): TenantEntitlements {
  return {
    customerId,
    planId: plan.id,
    features: plan.features,
    seatsIncluded: plan.seatsIncluded,
    seatsAssigned: [],
    usageLimits: plan.usageLimits,
  };
}
