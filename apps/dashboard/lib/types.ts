// Typed response shapes for the SettleKit API.
// These mirror the @settlekit/* package domain objects exposed over /v1/* endpoints.

export interface Money {
  amount: number; // minor units (e.g. cents / micro-USDC depending on currency)
  currency: string; // ISO 4217 or "USDC"
}

export type ProductSellType =
  | "saas_plan"
  | "github_repo"
  | "github_team"
  | "api_access"
  | "paid_api_call"
  | "agent_service"
  | "digital_download"
  | "code_template"
  | "license_key"
  | "discord_access"
  | "support_plan"
  | "bundle"
  | "dataset";

export type ChargeModel =
  | "one_time"
  | "monthly"
  | "yearly"
  | "prepaid_credits"
  | "per_api_call"
  | "custom_quote";

export type DeliveryActionType =
  | "github_repo_invite"
  | "github_team_add"
  | "issue_license_key"
  | "issue_api_key"
  | "grant_saas_entitlement"
  | "unlock_file"
  | "assign_discord_role"
  | "send_webhook"
  | "send_email";

export interface Product {
  id: string;
  name: string;
  sellType: ProductSellType;
  chargeModel: ChargeModel;
  price: Money;
  deliveryAction: DeliveryActionType;
  status: "draft" | "active" | "archived";
  createdAt: string;
}

export interface CreateProductInput {
  name: string;
  sellType: ProductSellType;
  chargeModel: ChargeModel;
  priceAmount: number;
  priceCurrency: string;
  deliveryAction: DeliveryActionType;
}

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  activeEntitlements: number;
  lifetimeValue: Money;
}

export interface Payment {
  id: string;
  customerEmail: string;
  amount: Money;
  status: "succeeded" | "pending" | "failed" | "refunded";
  rail: "arc" | "circle" | "x402";
  createdAt: string;
}

export interface Subscription {
  id: string;
  customerEmail: string;
  planName: string;
  status: "active" | "past_due" | "canceled" | "trialing";
  amount: Money;
  currentPeriodEnd: string;
}

export interface Entitlement {
  id: string;
  customerEmail: string;
  feature: string;
  source: string;
  status: "active" | "revoked";
  grantedAt: string;
}

export interface LicenseKey {
  id: string;
  key: string;
  customerEmail: string;
  productName: string;
  status: "active" | "revoked" | "expired";
  activations: number;
  maxActivations: number;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface FileAsset {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  downloads: number;
  createdAt: string;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: "enabled" | "disabled";
  lastDeliveryAt: string | null;
}

export interface Payout {
  id: string;
  amount: Money;
  status: "paid" | "in_transit" | "pending" | "failed";
  destination: string;
  arrivalDate: string;
}

export interface GithubInstallation {
  id: string;
  account: string;
  repositorySelection: "all" | "selected";
  installedAt: string;
}

export interface GithubRepository {
  id: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
}

export interface GithubTeam {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
}

export interface GithubAccessGrant {
  id: string;
  customerEmail: string;
  target: string;
  kind: "repo" | "team";
  status: "granted" | "pending" | "revoked";
  grantedAt: string;
}

export interface DiscordServer {
  id: string;
  name: string;
  memberCount: number;
  connectedAt: string;
}

export interface DiscordRole {
  id: string;
  name: string;
  serverName: string;
  color: string;
}

export interface DiscordAccessGrant {
  id: string;
  customerEmail: string;
  roleName: string;
  serverName: string;
  status: "granted" | "pending" | "revoked";
  grantedAt: string;
}

export interface SaasPlan {
  id: string;
  name: string;
  price: Money;
  interval: "monthly" | "yearly";
  features: string[];
  seats: number | null;
}

export interface SaasFeature {
  id: string;
  key: string;
  name: string;
  type: "boolean" | "metered" | "seat";
}

export interface Seat {
  id: string;
  planName: string;
  assignedTo: string | null;
  status: "assigned" | "open";
}

export interface Bundle {
  id: string;
  name: string;
  productIds: string[];
  price: Money;
  status: "draft" | "published";
  createdAt: string;
}

export interface DeliveryRun {
  id: string;
  productName: string;
  customerEmail: string;
  action: DeliveryActionType;
  status: "succeeded" | "failed" | "pending" | "retrying";
  attempts: number;
  startedAt: string;
}

export interface DeliveryLog {
  id: string;
  runId: string;
  level: "info" | "warn" | "error";
  message: string;
  at: string;
}

export interface AgentService {
  id: string;
  name: string;
  description: string;
  pricePerCall: Money;
  status: "draft" | "published";
  endpoint: string;
}

export interface EscrowTask {
  id: string;
  title: string;
  buyerEmail: string;
  workerEmail: string | null;
  amount: Money;
  status: "open" | "funded" | "submitted" | "approved" | "refunded";
  createdAt: string;
}

export interface AnalyticsSummary {
  revenue: Money;
  customers: number;
  activeAccess: number;
  expiringSubscriptions: number;
  failedDeliveries: number;
  mrr: Money;
  revenueSeries: { date: string; amount: number }[];
}

export interface OrgSettings {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: "arc" | "circle" | "x402";
}
