/**
 * Management API access policy: which scope a request needs, whether a key
 * is a platform (merchant) key at all, and what each team role may do.
 *
 * Scopes are `<resource>:read` or `<resource>:write` (write implies read).
 * `*` and `platform:admin` grant everything. Keys issued to BUYERS by access
 * delivery (e.g. `["read"]`) carry no management scope, so they can never
 * call the merchant's API.
 */
import type { ApiKey } from "@settlekit/common";

export const WILDCARD_SCOPE = "*";
export const PLATFORM_ADMIN_SCOPE = "platform:admin";

/** Resources a restricted key can be scoped to. */
export const SCOPE_RESOURCES = [
  "products",
  "checkout",
  "payments",
  "customers",
  "invoices",
  "webhooks",
  "reports",
  "settings",
  "api_keys",
  "team",
  "agents",
  "treasury",
  "access",
] as const;

export type ScopeResource = (typeof SCOPE_RESOURCES)[number];
export type ScopeAction = "read" | "write";
export type ManagementScope = `${ScopeResource}:${ScopeAction}`;

/** Every scope a restricted key may be issued with. */
export const MANAGEMENT_SCOPES: readonly ManagementScope[] = SCOPE_RESOURCES.flatMap((r) => [
  `${r}:read` as ManagementScope,
  `${r}:write` as ManagementScope,
]);

export function isManagementScope(scope: string): scope is ManagementScope {
  return (MANAGEMENT_SCOPES as readonly string[]).includes(scope);
}

/** First path segment (after /v1/) -> resource. */
const RESOURCE_BY_SEGMENT: Record<string, ScopeResource> = {
  products: "products",
  bundles: "products",
  saas: "products",
  marketplace: "products",
  "checkout-sessions": "checkout",
  payments: "payments",
  subscriptions: "payments",
  refunds: "payments",
  disputes: "payments",
  dunning: "payments",
  payouts: "payments",
  escrow: "payments",
  "onchain-escrow": "payments",
  "onchain-billing": "payments",
  customers: "customers",
  entitlements: "customers",
  "license-keys": "customers",
  files: "customers",
  github: "customers",
  discord: "customers",
  integrations: "customers",
  "delivery-runs": "customers",
  "delivery-actions": "customers",
  invoices: "invoices",
  coupons: "invoices",
  webhooks: "webhooks",
  analytics: "reports",
  exports: "reports",
  billing: "reports",
  onboarding: "reports",
  settings: "settings",
  "api-keys": "api_keys",
  team: "team",
  agents: "agents",
  "agent-services": "agents",
  jobs: "agents",
  usage: "agents",
  arc: "treasury",
  cctp: "treasury",
  gateway: "treasury",
  fx: "treasury",
  mint: "treasury",
  "user-wallets": "treasury",
  paymaster: "treasury",
  "gas-station": "treasury",
};

/** `/v1/merchant/<sub>` -> resource. */
const MERCHANT_SUBRESOURCE: Record<string, ScopeResource> = {
  profile: "settings",
  products: "products",
  payments: "payments",
  refunds: "payments",
  customers: "customers",
  balances: "reports",
  overview: "reports",
  networks: "reports",
};

/** POST routes that only read (access checks from a merchant's backend). */
const VERIFY_PATHS = [
  /^\/v1\/api-keys\/verify$/,
  /^\/v1\/license-keys\/verify$/,
  /^\/v1\/entitlements\/verify$/,
  /^\/v1\/saas\/entitlements\/verify$/,
  /^\/v1\/arc\/verify$/,
];

/** The scope a management request needs. */
export function requiredScope(method: string, path: string): string {
  const clean = path.split("?")[0]!.replace(/\/+$/, "");
  if (VERIFY_PATHS.some((re) => re.test(clean))) return "access:read";
  const segments = clean.replace(/^\/v1\//, "").split("/");
  const first = segments[0] ?? "";
  const resource =
    first === "merchant" ? (MERCHANT_SUBRESOURCE[segments[1] ?? ""] ?? "reports") : (RESOURCE_BY_SEGMENT[first] ?? null);
  const action: ScopeAction = method === "GET" || method === "HEAD" || method === "OPTIONS" ? "read" : "write";
  // Unknown routes need full access rather than slipping through.
  return resource ? `${resource}:${action}` : PLATFORM_ADMIN_SCOPE;
}

/** Whether a set of granted scopes satisfies `scope` (write implies read). */
export function scopesAllow(granted: readonly string[], scope: string): boolean {
  if (granted.includes(WILDCARD_SCOPE) || granted.includes(PLATFORM_ADMIN_SCOPE)) return true;
  if (granted.includes(scope)) return true;
  if (scope.endsWith(":read")) return granted.includes(scope.replace(/:read$/, ":write"));
  return false;
}

/** `productId` / `entitlementId` marker of merchant platform keys. */
export const PLATFORM_KEY_PRODUCT = "__platform__";

/**
 * Whether a key may call the management API at all: only keys issued as
 * platform keys (registration or POST /v1/api-keys/platform) with at least
 * one management scope. Keys delivered to BUYERS carry a real product id, so
 * they never qualify, whatever scopes the seller configured for them.
 */
export function isPlatformKey(apiKey: Pick<ApiKey, "scopes" | "status" | "productId">): boolean {
  if (apiKey.status !== "active" || apiKey.productId !== PLATFORM_KEY_PRODUCT) return false;
  return apiKey.scopes.some((s) => s === WILDCARD_SCOPE || s === PLATFORM_ADMIN_SCOPE || isManagementScope(s));
}

/** Team roles, most to least privileged. */
export const TEAM_ROLES = ["owner", "admin", "developer", "support", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

const READ_ALL = SCOPE_RESOURCES.map((r) => `${r}:read`);

/** Scopes each dashboard role gets. */
export function scopesForRole(role: TeamRole): string[] {
  switch (role) {
    case "owner":
      return [WILDCARD_SCOPE];
    case "admin":
      // Everything except managing the team's owners (enforced in team routes).
      return [WILDCARD_SCOPE];
    case "developer":
      return [
        ...READ_ALL,
        "products:write",
        "checkout:write",
        "webhooks:write",
        "api_keys:write",
        "agents:write",
        "invoices:write",
      ];
    case "support":
      return [...READ_ALL.filter((s) => s !== "api_keys:read" && s !== "settings:read"), "customers:write", "payments:write"];
    case "viewer":
      return READ_ALL.filter((s) => s !== "api_keys:read");
  }
}
