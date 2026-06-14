import type { Entitlement } from "@settlekit/common";
import { isPast } from "@settlekit/common";
import type { EntitlementDecision, VerifyEntitlementInput } from "./types.js";

export type { EntitlementDecision, VerifyEntitlementInput } from "./types.js";

export function isEntitlementActive(entitlement: Entitlement, now = new Date()): boolean {
  return entitlement.status === "active" && (!entitlement.expiresAt || !isPast(entitlement.expiresAt, now));
}

export function verifyEntitlement(input: VerifyEntitlementInput): EntitlementDecision {
  const now = input.now ?? new Date();
  const entitlement = input.entitlements.find((item) => {
    if (item.customerId !== input.customerId) return false;
    if (input.productId && item.productId !== input.productId) return false;
    if (input.resourceId && item.resourceId !== input.resourceId) return false;
    return true;
  });

  if (!entitlement) return { allowed: false, reason: "not_found" };
  if (entitlement.status !== "active") return { allowed: false, reason: "not_active", entitlement };
  if (entitlement.expiresAt && isPast(entitlement.expiresAt, now)) {
    return { allowed: false, reason: "expired", entitlement };
  }

  if (input.feature) {
    const value = entitlement.features?.[input.feature];
    if (value === undefined || value === false) {
      return { allowed: false, reason: "feature_missing", entitlement };
    }
    return { allowed: true, entitlement, value };
  }

  if (input.requiredCredits !== undefined) {
    const available = entitlement.creditsRemaining ?? 0;
    if (available < input.requiredCredits) {
      return { allowed: false, reason: available <= 0 ? "credits_exhausted" : "limit_exceeded", entitlement };
    }
  }

  return { allowed: true, entitlement };
}

export function consumeCredits(entitlement: Entitlement, amount: number): Entitlement {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new RangeError(`amount must be a positive integer, got ${amount}`);
  }
  const current = entitlement.creditsRemaining ?? 0;
  if (current < amount) {
    throw new RangeError(`insufficient credits: ${current} available, ${amount} requested`);
  }
  return { ...entitlement, creditsRemaining: current - amount, updatedAt: new Date().toISOString() };
}

export function mergeFeatureEntitlements(entitlements: Entitlement[]): Record<string, boolean | number | string> {
  return entitlements.filter((item) => isEntitlementActive(item)).reduce<Record<string, boolean | number | string>>((features, item) => {
    return { ...features, ...(item.features ?? {}) };
  }, {});
}
