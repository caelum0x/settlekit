export interface GitHubInstallation {
  id: string;
  organizationId: string;
  /** GitHub App installation id. */
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  createdAt: string;
}

export interface GitHubRepoAccessGrant {
  id: string;
  organizationId: string;
  installationId: number;
  customerId: string;
  entitlementId: string;
  repoOwner: string;
  repoName: string;
  githubUsername: string;
  invitationId?: number;
  status: "invited" | "active" | "revoked" | "failed";
  createdAt: string;
  revokedAt?: string;
}

export interface DiscordConnection {
  id: string;
  organizationId: string;
  guildId: string;
  guildName: string;
  /** Bot token reference (stored encrypted; never the raw token in app types). */
  botTokenRef: string;
  createdAt: string;
}

export interface DiscordRoleGrant {
  id: string;
  organizationId: string;
  guildId: string;
  roleId: string;
  customerId: string;
  entitlementId: string;
  discordUserId: string;
  status: "active" | "revoked" | "failed";
  createdAt: string;
  revokedAt?: string;
}

export type WebhookEventType =
  | "payment.confirmed"
  | "payment.failed"
  | "payment.refunded"
  | "subscription.created"
  | "subscription.renewed"
  | "subscription.canceled"
  | "entitlement.granted"
  | "entitlement.revoked"
  | "delivery.succeeded"
  | "delivery.failed";

export interface WebhookEndpoint {
  id: string;
  organizationId: string;
  url: string;
  /** Secret used to sign payloads (HMAC-SHA256). */
  signingSecret: string;
  enabledEvents: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

export interface WebhookEvent {
  id: string;
  organizationId: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AgentService {
  id: string;
  organizationId: string;
  merchantId: string;
  productId: string;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  currency: "USDC";
  paymentProtocol: "x402";
  network: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  published: boolean;
  createdAt: string;
}

export type EscrowStatus =
  | "created"
  | "funded"
  | "assigned"
  | "submitted"
  | "approved"
  | "released"
  | "refunded"
  | "disputed";

export interface EscrowTask {
  id: string;
  organizationId: string;
  buyerCustomerId: string;
  workerCustomerId?: string;
  title: string;
  description: string;
  amount: string;
  currency: "USDC";
  status: EscrowStatus;
  fundingTxHash?: string;
  releaseTxHash?: string;
  createdAt: string;
}

export interface MarketplaceListing {
  id: string;
  organizationId: string;
  merchantId: string;
  productId?: string;
  agentServiceId?: string;
  title: string;
  summary: string;
  tags: string[];
  published: boolean;
  ratingAverage: number;
  ratingCount: number;
  createdAt: string;
}

export interface RiskProfile {
  id: string;
  organizationId: string;
  /** 0 (low) .. 100 (high). */
  score: number;
  flags: string[];
  updatedAt: string;
}
