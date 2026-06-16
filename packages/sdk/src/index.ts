/**
 * @settlekit/sdk — the official TypeScript server-side SDK for SettleKit.
 *
 * A dependency-light, typed `fetch` client over the SettleKit REST API:
 *
 * ```ts
 * import { createSettleKitClient } from "@settlekit/sdk";
 *
 * const settlekit = createSettleKitClient({ apiKey: process.env.SETTLEKIT_API_KEY! });
 * const result = await settlekit.entitlements.verify({ customerId, feature: "pro" });
 * ```
 */

// Core client + factory.
export { SettleKit, createSettleKitClient } from "./client.js";
export type { SettleKitOptions } from "./client.js";

// HTTP client + per-call options.
export { HttpClient, DEFAULT_BASE_URL, DEFAULT_TIMEOUT_MS } from "./http-client.js";
export type {
  HttpClientOptions,
  RequestOptions,
  QueryParams,
  FetchLike,
} from "./http-client.js";

// Errors.
export { SettleKitApiError } from "./errors.js";
export type { SettleKitApiErrorOptions, ApiErrorBody } from "./errors.js";

// Core domain entity types (re-exported so consumers can name what the
// resource methods return without importing `@settlekit/common` directly).
export type {
  Money,
  Product,
  ProductType,
  DeliveryMode,
  Price,
  Customer,
  CheckoutSession,
  Payment,
  Subscription,
  Entitlement,
  LicenseKey,
  ApiKey,
  Bundle,
} from "@settlekit/common";

// Resource clients.
export { ProductsResource } from "./resources/products.js";
export { PricesResource } from "./resources/prices.js";
export { CustomersResource } from "./resources/customers.js";
export { CheckoutResource } from "./resources/checkout.js";
export { PaymentsResource } from "./resources/payments.js";
export { SubscriptionsResource } from "./resources/subscriptions.js";
export { EntitlementsResource } from "./resources/entitlements.js";
export { LicenseKeysResource } from "./resources/license-keys.js";
export { ApiKeysResource } from "./resources/api-keys.js";
export { BundlesResource } from "./resources/bundles.js";
export { FilesResource } from "./resources/files.js";
export { WebhooksResource, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from "./resources/webhooks.js";
export type { VerifyWebhookOptions } from "./resources/webhooks.js";
export { DeliveryRunsResource } from "./resources/delivery-runs.js";
export { AgentServicesResource } from "./resources/agent-services.js";
export { EscrowResource } from "./resources/escrow.js";
export { GitHubResource } from "./resources/github.js";
export { DiscordResource } from "./resources/discord.js";
export { SaasResource } from "./resources/saas.js";
export { UsageResource } from "./resources/usage.js";
export type { MeterRef, BalanceRef, LimitCheck } from "./resources/usage.js";
export { MarketplaceResource } from "./resources/marketplace.js";
export type { CreateListingInput, ListingSearch, SellerProfile } from "./resources/marketplace.js";
export { AnalyticsResource } from "./resources/analytics.js";
export type { AnalyticsSummary } from "./resources/analytics.js";
export { CouponsResource } from "./resources/coupons.js";
export type { Coupon, CouponDiscount, CreateCouponInput, CouponApplyResult } from "./resources/coupons.js";
export { InvoicesResource } from "./resources/invoices.js";
export type { Invoice, InvoiceLineItemInput, CreateInvoiceInput } from "./resources/invoices.js";
export { PayoutsResource } from "./resources/payouts.js";
export type { Payout, CreatePayoutInput } from "./resources/payouts.js";
export { RefundsResource } from "./resources/refunds.js";
export type {
  Refund,
  RefundReason,
  RefundStatus,
  CreateRefundInput,
  ListRefundsInput,
} from "./resources/refunds.js";
export { DisputesResource } from "./resources/disputes.js";
export type {
  Dispute,
  DisputeReason,
  DisputeStatus,
  DisputeEvidence,
  DisputeEvidenceKind,
  DisputeOutcome,
  OpenDisputeInput,
  SubmitEvidenceInput,
} from "./resources/disputes.js";
export { DunningResource } from "./resources/dunning.js";
export type {
  DunningState,
  DunningStatus,
  DunningAttemptRecord,
  DunningOutcome,
} from "./resources/dunning.js";
export { SettingsResource } from "./resources/settings.js";
export type {
  OrgSettings,
  PaymentRail,
  UpdateSettingsInput,
} from "./resources/settings.js";

// Resource input/output option types.
export type { CreateProductInput, CreatePriceInput } from "./resources/products.js";
export type { CreateCustomerInput } from "./resources/customers.js";
export type {
  CheckoutLineItemInput,
  CreateCheckoutSessionInput,
} from "./resources/checkout.js";
export type {
  RecordPaymentInput,
  ConfirmPaymentInput,
  ConfirmPaymentResult,
} from "./resources/payments.js";
export type {
  CreateSubscriptionInput,
  CreateSubscriptionResult,
} from "./resources/subscriptions.js";
export type {
  ListEntitlementsParams,
  VerifyEntitlementInput,
  VerifyEntitlementResult,
  SpendCreditsInput,
} from "./resources/entitlements.js";
export type {
  IssueLicenseKeyInput,
  VerifyLicenseKeyInput,
  VerifyLicenseKeyResult,
} from "./resources/license-keys.js";
export type {
  IssueApiKeyInput,
  IssueApiKeyResult,
  VerifyApiKeyInput,
  VerifyApiKeyResult,
} from "./resources/api-keys.js";
export type {
  CreateBundleInput,
  UpdateBundleInput,
  ListBundlesParams,
} from "./resources/bundles.js";
export type {
  IssueDownloadInput,
  IssueDownloadResult,
  RedeemDownloadResult,
} from "./resources/files.js";
export type {
  CreateWebhookEndpointInput,
  EmitWebhookEventInput,
  WebhookDelivery,
  EmitWebhookEventResult,
} from "./resources/webhooks.js";
export type {
  ListDeliveryRunsParams,
  TestDeliveryActionInput,
  TestDeliveryActionResult,
} from "./resources/delivery-runs.js";
export type {
  CreateAgentServiceInput,
  UpdateAgentServiceInput,
  ListAgentServicesParams,
} from "./resources/agent-services.js";
export type { CreateEscrowTaskInput } from "./resources/escrow.js";
export type {
  ConnectGitHubInstallationInput,
  GrantGitHubAccessInput,
  GitHubRepositorySummary,
  GitHubTeamSummary,
  GitHubSyncOutcome,
  GitHubSyncResult,
} from "./resources/github.js";
export type {
  ConnectDiscordInput,
  GrantDiscordRoleInput,
  DiscordGuildSummary,
  DiscordRoleSummary,
} from "./resources/discord.js";
export type {
  SaasPlan,
  SaasEntitlement,
  CreateSaasPlanInput,
  GrantSaasEntitlementInput,
  VerifySaasEntitlementInput,
  VerifySaasEntitlementResult,
  AddSeatInput,
  RemoveSeatInput,
} from "./resources/saas.js";
