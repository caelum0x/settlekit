import type { ApiKey } from "@settlekit/common";

/**
 * Return a new {@link ApiKey} with `lastUsedAt` stamped to `now`.
 *
 * Immutable: the input record is never mutated; callers persist the returned
 * copy. Recording usage on a revoked key is a no-op-shaped copy that still
 * reflects the new timestamp, so audit trails remain accurate.
 */
export function recordUsage(apiKey: ApiKey, now: Date = new Date()): ApiKey {
  return { ...apiKey, lastUsedAt: now.toISOString() };
}

/**
 * Return a new {@link ApiKey} with status flipped to `"revoked"`.
 *
 * Immutable: produces a fresh record so existing references are unaffected.
 * Revoking an already-revoked key is idempotent.
 */
export function revoke(apiKey: ApiKey): ApiKey {
  if (apiKey.status === "revoked") {
    return apiKey;
  }
  return { ...apiKey, status: "revoked" };
}
