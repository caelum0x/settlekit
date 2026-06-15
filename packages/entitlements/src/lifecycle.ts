import type { Entitlement } from "@settlekit/common";
import { isPast, toIso } from "@settlekit/common";

/**
 * An entitlement is active when its status is "active" and it has not passed its
 * expiry instant. A missing `expiresAt` means it never expires.
 */
export function isActive(entitlement: Entitlement, now: Date = new Date()): boolean {
  if (entitlement.status !== "active") return false;
  if (entitlement.expiresAt && isPast(entitlement.expiresAt, now)) return false;
  return true;
}

/**
 * From a set of entitlements, return those that are still marked "active" but
 * whose expiry has passed — i.e. the ones a sweep job should transition to
 * "expired". Returns the original references (no mutation).
 */
export function expireDue(entitlements: readonly Entitlement[], now: Date = new Date()): Entitlement[] {
  return entitlements.filter(
    (e) => e.status === "active" && e.expiresAt !== undefined && isPast(e.expiresAt, now),
  );
}

/**
 * Transition an entitlement to "expired", returning a NEW entitlement (immutable).
 * No-op semantics: already-expired/revoked entitlements still produce a fresh
 * object with the updated status and timestamp for idempotent persistence.
 */
export function expire(entitlement: Entitlement, now: Date = new Date()): Entitlement {
  return {
    ...entitlement,
    status: "expired",
    updatedAt: toIso(now),
  };
}

/**
 * Revoke an entitlement (e.g. refund, chargeback, manual removal), returning a
 * NEW entitlement with status "revoked". The reason is recorded in `features`
 * under the reserved `__revokedReason` key so it survives persistence without a
 * schema change.
 */
export function revoke(entitlement: Entitlement, reason: string, now: Date = new Date()): Entitlement {
  return {
    ...entitlement,
    status: "revoked",
    features: { ...(entitlement.features ?? {}), __revokedReason: reason },
    updatedAt: toIso(now),
  };
}
