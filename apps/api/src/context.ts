/**
 * Application context: builds the real service singletons the routes depend on.
 *
 * Persistence is selected at boot by `DATABASE_URL`:
 *   - set   -> real Postgres-backed stores (@settlekit/database via the Pg
 *              adapters in ./db/pg/*), after ensuring the default org+merchant
 *              exist (see ./db/seed.ts). Apply migrations out-of-band with
 *              `pnpm --filter @settlekit/database db:migrate`.
 *   - unset -> the in-memory stores the @settlekit packages ship, so the API
 *              still runs fully end-to-end with no external infrastructure.
 *
 * Integration clients (delivery transports, Arc verifier, Circle, email) are
 * constructed from environment secrets by {@link buildIntegrations}; when creds
 * are absent the in-process fallbacks are used. The context is built once at
 * startup and shared read-only across requests.
 */
import { createDb, type Database } from "@settlekit/database";
import {
  EntitlementService,
  InMemoryEntitlementRepository,
  type EntitlementRepository,
} from "@settlekit/entitlements";
import {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  InMemorySubscriptionRepository,
  type CheckoutRepository,
  type PaymentRepository,
  type SubscriptionRepository,
} from "@settlekit/payments";
import { ApiKeyService, InMemoryApiKeyStore, type ApiKeyStore } from "@settlekit/api-keys";
import { AuthService, InMemoryAuthStore } from "@settlekit/auth";
import { LicenseService, InMemoryLicenseStore, type LicenseStore } from "@settlekit/license-keys";
import {
  SaasService,
  InMemoryPlanStore,
  InMemorySeatStore,
  type PlanStore,
  type SeatStore,
} from "@settlekit/saas";
import { BundleService, InMemoryBundleStore, type BundleStore } from "@settlekit/bundles";
import {
  AgentServiceService,
  InMemoryAgentServiceStore,
  InMemoryAgentUsageStore,
  InMemoryAgentReputationStore,
  type AgentServiceStore,
  type AgentUsageStore,
  type AgentReputationStore,
} from "@settlekit/agent-services";
import { EscrowService, InMemoryEscrowStore, type EscrowStore } from "@settlekit/escrow";
import { CouponService, InMemoryCouponStore, type CouponStore } from "@settlekit/coupons";
import {
  InvoiceService,
  InMemoryInvoiceStore,
  type InvoiceStore,
  type Merchant,
} from "@settlekit/invoices";
import {
  FileDeliveryService,
  InMemoryGrantStore,
  type GrantStore,
} from "@settlekit/file-delivery";
import {
  createDefaultRegistry,
  type DeliveryClients,
  type HandlerRegistry,
} from "@settlekit/delivery";
import type { PaymentVerifier } from "@settlekit/x402";
import type { CircleClient } from "@settlekit/circle";
import type { EmailClient } from "@settlekit/notifications";
import type {
  Customer,
  DeliveryRun,
  DiscordConnection,
  DiscordRoleGrant,
  GitHubInstallation,
  GitHubRepoAccessGrant,
  Price,
  Product,
  WebhookEndpoint,
  WebhookEvent,
} from "@settlekit/common";
import { InMemoryGitHubAccessClient } from "./clients/in-memory-github-client.js";
import { InMemoryDiscordApi } from "./clients/in-memory-discord-client.js";
import { InMemoryEntityStore, type EntityStore } from "./db/entity-store.js";
import { seedDefaults } from "./db/seed.js";
import { PgProductStore } from "./db/pg/products-store.js";
import { PgPriceStore } from "./db/pg/prices-store.js";
import { PgCustomerStore } from "./db/pg/customers-store.js";
import { PgDeliveryRunStore } from "./db/pg/delivery-runs-store.js";
import { PgWebhookEndpointStore } from "./db/pg/webhook-endpoints-store.js";
import { PgWebhookEventStore } from "./db/pg/webhook-events-store.js";
import { PgGitHubInstallationStore } from "./db/pg/github-installations-store.js";
import { PgGitHubRepoAccessGrantStore } from "./db/pg/github-grants-store.js";
import { PgDiscordConnectionStore } from "./db/pg/discord-connections-store.js";
import { PgDiscordRoleGrantStore } from "./db/pg/discord-grants-store.js";
import { PgCheckoutRepository } from "./db/pg/checkout-repository.js";
import { PgPaymentRepository } from "./db/pg/payment-repository.js";
import { PgSubscriptionRepository } from "./db/pg/subscription-repository.js";
import { PgEntitlementRepository } from "./db/pg/entitlement-repository.js";
import { PgApiKeyStore } from "./db/pg/api-key-store.js";
import { PgLicenseStore } from "./db/pg/license-store.js";
import { PgPlanStore } from "./db/pg/plan-store.js";
import { PgBundleStore } from "./db/pg/bundle-store.js";
import { PgAgentServiceStore } from "./db/pg/agent-service-store.js";
import { PgAgentUsageStore } from "./db/pg/agent-usage-store.js";
import { PgAgentReputationStore } from "./db/pg/agent-reputation-store.js";
import { PgSeatStore } from "./db/pg/seat-store.js";
import { PgGrantStore } from "./db/pg/file-grant-store.js";
import { PgEscrowStore } from "./db/pg/escrow-store.js";
import { loadConfig } from "./config/env.js";
import { buildIntegrations } from "./config/integrations.js";

/** The fully-wired set of services + stores shared across requests. */
export interface AppContext {
  /** Real drizzle database handle (only when DATABASE_URL is set). */
  readonly db: Database | null;
  /** True when running against Postgres. */
  readonly persistent: boolean;

  // Core commerce repositories (interface-typed: Postgres or in-memory).
  readonly checkouts: CheckoutRepository;
  readonly payments: PaymentRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly entitlementRepo: EntitlementRepository;
  readonly entitlements: EntitlementService;

  // Resource stores without a packaged store.
  readonly products: EntityStore<Product>;
  readonly prices: EntityStore<Price>;
  readonly customers: EntityStore<Customer>;
  readonly deliveryRuns: EntityStore<DeliveryRun>;
  readonly deliveryRegistry: HandlerRegistry;
  readonly deliveryClients: DeliveryClients;
  readonly webhookEndpoints: EntityStore<WebhookEndpoint>;
  readonly webhookEvents: EntityStore<WebhookEvent>;

  // Access / key services.
  readonly apiKeys: ApiKeyService;
  readonly licenses: LicenseService;
  readonly files: FileDeliveryService;

  // Authentication (account/session/magic-link) for the public /v1/auth routes.
  readonly auth: AuthService;
  /** HMAC secret used to sign the `sk_session` cookie. */
  readonly authCookieSecret: string;

  // Integration clients (real when configured; null/in-memory otherwise).
  readonly arcVerifier: PaymentVerifier | null;
  readonly circle: CircleClient | null;
  readonly email: EmailClient | null;

  // GitHub integration (management routes).
  readonly githubClient: InMemoryGitHubAccessClient;
  readonly githubInstallations: EntityStore<GitHubInstallation>;
  readonly githubGrants: EntityStore<GitHubRepoAccessGrant>;

  // Discord integration (management routes).
  readonly discordApi: InMemoryDiscordApi;
  readonly discordConnections: EntityStore<DiscordConnection>;
  readonly discordGrants: EntityStore<DiscordRoleGrant>;

  // SaaS / bundles / agent services / escrow.
  readonly saas: SaasService;
  readonly bundles: BundleService;
  readonly bundleStore: BundleStore;
  readonly agentServices: AgentServiceService;
  readonly agentServiceStore: AgentServiceStore;
  readonly escrow: EscrowService;

  // Commerce engines: coupons (discounts) + invoices.
  readonly coupons: CouponService;
  readonly couponStore: CouponStore;
  readonly invoices: InvoiceService;
  readonly invoiceStore: InvoiceStore;
  /** Merchant identity used when rendering invoice HTML/text. */
  readonly merchant: Merchant;
}

/** Pick the Postgres implementation when `db` is set, else the in-memory one. */
function pick<T>(db: Database | null, makePg: (db: Database) => T, makeMem: () => T): T {
  return db ? makePg(db) : makeMem();
}

/**
 * Build the singleton {@link AppContext}, wiring every service + store.
 * Async because Postgres mode seeds the default account on boot.
 */
export async function createContext(): Promise<AppContext> {
  const config = loadConfig();
  const db = config.database ? createDb(config.database.url) : null;
  if (db) {
    await seedDefaults(db);
  }

  const integrations = buildIntegrations(config);

  const products = pick<EntityStore<Product>>(db, (d) => new PgProductStore(d), () => new InMemoryEntityStore<Product>());

  // Bundle validation needs a synchronous product-existence check, but Postgres
  // lookups are async — so track known product ids in a set (primed at boot,
  // updated on save) and gate bundle creation against it.
  const knownProductIds = new Set<string>();
  for (const p of await products.list()) knownProductIds.add(p.id);
  const trackedProducts: EntityStore<Product> = {
    async save(p) { const r = await products.save(p); knownProductIds.add(p.id); return r; },
    findById: (id) => products.findById(id),
    list: (predicate) => products.list(predicate),
    async delete(id) { const ok = await products.delete(id); if (ok) knownProductIds.delete(id); return ok; },
  };

  const entitlementRepo = pick<EntitlementRepository>(db, (d) => new PgEntitlementRepository(d), () => new InMemoryEntitlementRepository());
  const apiKeyStore = pick<ApiKeyStore>(db, (d) => new PgApiKeyStore(d), () => new InMemoryApiKeyStore());
  const licenseStore = pick<LicenseStore>(db, (d) => new PgLicenseStore(d), () => new InMemoryLicenseStore());
  const planStore = pick<PlanStore>(db, (d) => new PgPlanStore(d), () => new InMemoryPlanStore());
  const bundleStore = pick<BundleStore>(db, (d) => new PgBundleStore(d), () => new InMemoryBundleStore());
  const agentServiceStore = pick<AgentServiceStore>(db, (d) => new PgAgentServiceStore(d), () => new InMemoryAgentServiceStore());
  const seatStore = pick<SeatStore>(db, (d) => new PgSeatStore(d), () => new InMemorySeatStore());
  const agentUsageStore = pick<AgentUsageStore>(db, (d) => new PgAgentUsageStore(d), () => new InMemoryAgentUsageStore());
  const agentReputationStore = pick<AgentReputationStore>(db, (d) => new PgAgentReputationStore(d), () => new InMemoryAgentReputationStore());
  const grantStore = pick<GrantStore>(db, (d) => new PgGrantStore(d), () => new InMemoryGrantStore());

  // Coupons + invoices use in-memory stores (interface-typed) on the context.
  const couponStore: CouponStore = new InMemoryCouponStore();
  const invoiceStore: InvoiceStore = new InMemoryInvoiceStore();
  const merchant: Merchant = {
    name: process.env.MERCHANT_NAME ?? "SettleKit Merchant",
    ...(process.env.MERCHANT_EMAIL ? { email: process.env.MERCHANT_EMAIL } : {}),
    ...(process.env.MERCHANT_WEBSITE ? { website: process.env.MERCHANT_WEBSITE } : {}),
  };

  return {
    db,
    persistent: db !== null,

    checkouts: pick<CheckoutRepository>(db, (d) => new PgCheckoutRepository(d), () => new InMemoryCheckoutRepository()),
    payments: pick<PaymentRepository>(db, (d) => new PgPaymentRepository(d), () => new InMemoryPaymentRepository()),
    subscriptions: pick<SubscriptionRepository>(db, (d) => new PgSubscriptionRepository(d), () => new InMemorySubscriptionRepository()),
    entitlementRepo,
    entitlements: new EntitlementService(entitlementRepo),

    products: trackedProducts,
    prices: pick<EntityStore<Price>>(db, (d) => new PgPriceStore(d), () => new InMemoryEntityStore<Price>()),
    customers: pick<EntityStore<Customer>>(db, (d) => new PgCustomerStore(d), () => new InMemoryEntityStore<Customer>()),
    deliveryRuns: pick<EntityStore<DeliveryRun>>(db, (d) => new PgDeliveryRunStore(d), () => new InMemoryEntityStore<DeliveryRun>()),
    deliveryRegistry: createDefaultRegistry(),
    deliveryClients: integrations.deliveryClients,
    webhookEndpoints: pick<EntityStore<WebhookEndpoint>>(db, (d) => new PgWebhookEndpointStore(d), () => new InMemoryEntityStore<WebhookEndpoint>()),
    webhookEvents: pick<EntityStore<WebhookEvent>>(db, (d) => new PgWebhookEventStore(d), () => new InMemoryEntityStore<WebhookEvent>()),

    apiKeys: new ApiKeyService(apiKeyStore),
    licenses: new LicenseService(licenseStore, { tokenSecret: config.licenseTokenSecret }),
    files: new FileDeliveryService(grantStore, {
      baseUrl: config.fileDelivery.baseUrl,
      secret: config.fileDelivery.secret,
      defaultExpiresInSec: config.fileDelivery.defaultExpiresInSec,
      defaultMaxDownloads: config.fileDelivery.defaultMaxDownloads,
    }),

    auth: new AuthService(new InMemoryAuthStore()),
    authCookieSecret: config.authCookieSecret,

    arcVerifier: integrations.arcVerifier,
    circle: integrations.circle,
    email: integrations.email,

    githubClient: new InMemoryGitHubAccessClient(),
    githubInstallations: pick<EntityStore<GitHubInstallation>>(db, (d) => new PgGitHubInstallationStore(d), () => new InMemoryEntityStore<GitHubInstallation>()),
    githubGrants: pick<EntityStore<GitHubRepoAccessGrant>>(db, (d) => new PgGitHubRepoAccessGrantStore(d), () => new InMemoryEntityStore<GitHubRepoAccessGrant>()),

    discordApi: new InMemoryDiscordApi(),
    discordConnections: pick<EntityStore<DiscordConnection>>(db, (d) => new PgDiscordConnectionStore(d), () => new InMemoryEntityStore<DiscordConnection>()),
    discordGrants: pick<EntityStore<DiscordRoleGrant>>(db, (d) => new PgDiscordRoleGrantStore(d), () => new InMemoryEntityStore<DiscordRoleGrant>()),

    saas: new SaasService({ plans: planStore, seats: seatStore }),
    bundles: new BundleService(bundleStore, (productId: string) => knownProductIds.has(productId)),
    bundleStore,
    agentServices: new AgentServiceService({
      services: agentServiceStore,
      usage: agentUsageStore,
      reputation: agentReputationStore,
    }),
    agentServiceStore,
    escrow: new EscrowService(pick<EscrowStore>(db, (d) => new PgEscrowStore(d), () => new InMemoryEscrowStore())),

    coupons: new CouponService(couponStore),
    couponStore,
    invoices: new InvoiceService(invoiceStore),
    invoiceStore,
    merchant,
  };
}

/** Hono `Variables` binding: the context is attached to every request. */
export interface AppEnv {
  Variables: {
    ctx: AppContext;
    apiKeyId?: string;
  };
}
