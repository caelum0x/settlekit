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

/**
 * A merchant payout from `@settlekit/payouts`. Money is a DECIMAL STRING
 * amount (use `formatMoneyDecimal`); `walletAddress`/`network` describe the
 * on-chain settlement destination.
 */
export interface Payout {
  id: string;
  organizationId: string;
  walletAddress: string;
  amount: DecimalMoney;
  network: "arc" | "base" | "ethereum";
  status: "pending" | "paid" | "failed";
  txHash?: string;
  failureReason?: string;
  createdAt: string;
  paidAt?: string;
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

export interface UsageMeter {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  metric: string;
  value: number;
  periodStart: string;
  periodEnd: string;
}

export interface CreditBalance {
  id: string;
  organizationId: string;
  customerId: string;
  productId: string;
  creditsRemaining: number;
  creditsGranted: number;
  updatedAt: string;
}

export interface MarketplaceListing {
  id: string;
  organizationId: string;
  merchantId: string;
  productId?: string;
  title: string;
  summary: string;
  tags: string[];
  published: boolean;
  ratingAverage: number;
  ratingCount: number;
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

/**
 * The coupons + invoices APIs serialize money as a DECIMAL STRING amount
 * (e.g. "55.2075") rather than the minor-unit number used elsewhere in this
 * dashboard. Format these with `formatMoneyDecimal`.
 */
export interface DecimalMoney {
  amount: string;
  currency: string;
}

export type CouponDiscount =
  | { type: "percent"; percentOff: number }
  | { type: "amount"; amountOff: DecimalMoney }
  | { type: "free-trial-days"; days: number };

export interface Coupon {
  code: string;
  name?: string;
  discount: CouponDiscount;
  currency: string;
  status: "active" | "archived";
  startsAt?: string;
  expiresAt?: string;
  maxRedemptions?: number;
  redeemedCount: number;
  perCustomerLimit?: number;
  minSubtotal?: DecimalMoney;
  appliesToProductIds?: string[];
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitAmount: DecimalMoney;
}

export interface Invoice {
  id: string;
  number: string;
  organizationId: string;
  customerId: string;
  lineItems: InvoiceLineItem[];
  subtotal: DecimalMoney;
  discount?: DecimalMoney;
  tax?: DecimalMoney;
  total: DecimalMoney;
  currency: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  metadata: Record<string, string>;
}

export interface OrgSettings {
  orgName: string;
  supportEmail: string;
  payoutCurrency: string;
  webhookSecret: string;
  defaultRail: "arc" | "circle" | "x402";
}

// --- Refunds / dunning / disputes (decimal-string money) ------------------

export type RefundReason =
  | "duplicate"
  | "fraudulent"
  | "customer_request"
  | "delivery_failed";

/** A refund from `@settlekit/refunds`. Amount is a decimal string. */
export interface Refund {
  id: string;
  paymentId: string;
  customerId: string;
  amount: DecimalMoney;
  reason: RefundReason;
  status: "pending" | "succeeded" | "failed";
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DunningSchedule {
  offsetsDays: number[];
}

export interface DunningAttemptRecord {
  attempt: number;
  outcome: "succeeded" | "failed";
  at: string;
  failureReason?: string;
}

/** A dunning campaign from `@settlekit/dunning`, keyed by subscription. */
export interface DunningState {
  subscriptionId: string;
  attempt: number;
  schedule: DunningSchedule;
  nextAttemptAt?: string;
  status: "active" | "recovered" | "exhausted";
  history: DunningAttemptRecord[];
  startedAt: string;
  updatedAt: string;
}

export type DisputeReason = "fraud" | "not_received" | "duplicate" | "quality" | "unrecognized";

export interface DisputeEvidence {
  id: string;
  kind: "text" | "receipt" | "shipping" | "communication" | "url" | "file";
  description: string;
  value: string;
  submittedAt: string;
}

/** A payment dispute / chargeback from `@settlekit/disputes`. */
export interface Dispute {
  id: string;
  paymentId: string;
  customerId: string;
  reason: DisputeReason;
  status: "open" | "under_review" | "won" | "lost" | "refunded";
  evidence: DisputeEvidence[];
  openedAt: string;
  updatedAt: string;
  resolvedAt?: string;
}
