// Typed response shapes for the SettleKit customer portal.
// These mirror the @settlekit/* domain objects exposed over the /v1/* API.
// The portal reads a single customer's data; the entitlement is the universal
// access record (plan §14) that every other view is derived from.

export type Currency = "USDC";

/** A monetary value: a decimal string in the major unit + currency. */
export interface Money {
  /** Decimal string in the major unit, e.g. "25.5" or "0.005". */
  amount: string;
  currency: Currency;
}

export interface Customer {
  id: string;
  organizationId: string;
  email: string;
  name?: string;
  walletAddress?: string;
  githubUsername?: string;
  discordUserId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

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

export interface EntitlementSource {
  type: "payment" | "subscription" | "bundle" | "manual";
  id: string;
}

export interface Entitlement {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  grantedBy: EntitlementSource;
  entitlementType: EntitlementType;
  resourceId?: string;
  status: EntitlementStatus;
  features?: Record<string, boolean | number | string>;
  creditsRemaining?: number;
  seats?: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type PaymentNetwork = "arc" | "base" | "ethereum";
export type PaymentStatus = "pending" | "confirmed" | "failed" | "refunded";

export interface Payment {
  id: string;
  organizationId: string;
  checkoutSessionId: string;
  customerId: string;
  amount: Money;
  network: PaymentNetwork;
  txHash?: string;
  confirmations: number;
  status: PaymentStatus;
  createdAt: string;
  confirmedAt?: string;
}

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "expired"
  | "in_grace";

export interface Subscription {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  priceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  graceEndsAt?: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

export interface LicenseKey {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  key: string;
  status: "active" | "revoked" | "expired";
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
  keyHash: string;
  keyPrefix: string;
  scopes: string[];
  status: "active" | "revoked";
  lastUsedAt?: string;
  createdAt: string;
}

export type ChargeModel =
  | "one_time"
  | "monthly"
  | "yearly"
  | "prepaid_credits"
  | "per_api_call"
  | "custom_quote";

export interface Product {
  id: string;
  organizationId?: string;
  name: string;
  description?: string;
  status?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface SignedDownload {
  url: string;
  expiresAt?: string;
  maxDownloads?: number;
  grant?: { id: string; fileId: string; customerId: string };
  [key: string]: unknown;
}
