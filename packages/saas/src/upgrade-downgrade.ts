import type { SaasPlan, TenantEntitlements } from "./types.js";

export function changePlan(current: TenantEntitlements, nextPlan: SaasPlan): TenantEntitlements {
  if (current.seatsAssigned.length > nextPlan.seatsIncluded) {
    throw new RangeError("cannot downgrade below assigned seat count");
  }
  return {
    ...current,
    planId: nextPlan.id,
    features: nextPlan.features,
    seatsIncluded: nextPlan.seatsIncluded,
    usageLimits: nextPlan.usageLimits,
  };
}
