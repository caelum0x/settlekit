/**
 * The core abstraction (plan §14): payment grants an entitlement, an entitlement
 * grants access. Every access type — GitHub, SaaS, API, file, Discord, license,
 * package, agent tool — is modeled as an entitlement.
 */
export type EntitlementType =
  | "github_repo_access"
  | "github_team_access"
  | "saas_feature"
  | "api_credits"
  | "api_access"
  | "file_access"
  | "discord_role"
  | "license_key"
  | "private_package"
  | "support_plan"
  | "agent_service";

export type EntitlementStatus = "active" | "expired" | "revoked" | "pending";

export interface Entitlement {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  /** Source payment/subscription that granted this entitlement. */
  grantedBy: { type: "payment" | "subscription" | "bundle" | "manual"; id: string };
  entitlementType: EntitlementType;
  /** Identifier of the underlying resource (repo id, role id, file id...). */
  resourceId?: string;
  status: EntitlementStatus;
  /** SaaS feature flags / limits, when entitlementType === "saas_feature". */
  features?: Record<string, boolean | number | string>;
  /** Remaining credits, when entitlementType === "api_credits". */
  creditsRemaining?: number;
  /** Seat allotment for team plans. */
  seats?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseKey {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  /** The opaque key string presented to the buyer. */
  key: string;
  status: "active" | "revoked" | "expired";
  /** Max distinct machines that may activate this key. */
  machineLimit: number;
  activatedMachineIds: string[];
  domainLimit?: number;
  activatedDomains: string[];
  expiresAt?: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  /** Stored as a SHA-256 hash; the plaintext is shown once at creation. */
  keyHash: string;
  /** Non-secret prefix for display, e.g. "sk_live_ab12". */
  keyPrefix: string;
  scopes: string[];
  status: "active" | "revoked";
  lastUsedAt?: string;
  createdAt: string;
}
