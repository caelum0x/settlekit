import type { ApiKey } from "@settlekit/common";

/**
 * Returns true if the key is active and grants the given scope.
 *
 * A wildcard scope of `"*"` grants every scope. Revoked keys never satisfy a
 * scope check regardless of their granted scopes.
 */
export function hasScope(apiKey: ApiKey, scope: string): boolean {
  if (apiKey.status !== "active") {
    return false;
  }
  return apiKey.scopes.includes("*") || apiKey.scopes.includes(scope);
}

/** Returns true only if the key satisfies every requested scope. */
export function hasAllScopes(apiKey: ApiKey, scopes: readonly string[]): boolean {
  return scopes.every((scope) => hasScope(apiKey, scope));
}
