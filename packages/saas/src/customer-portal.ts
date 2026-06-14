import type { TenantEntitlements } from "./types.js";

export function buildCustomerPortalSummary(entitlements: TenantEntitlements) {
  return {
    planId: entitlements.planId,
    seatsUsed: entitlements.seatsAssigned.length,
    seatsIncluded: entitlements.seatsIncluded,
    features: entitlements.features,
    usageLimits: entitlements.usageLimits,
  };
}
