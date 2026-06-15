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
import { AuthService, InMemoryAuthStore, type AuthStore } from "@settlekit/auth";
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
import {
  MarketplaceService,
  InMemoryListingStore,
  type ListingStore,
  type PriceResolver,
} from "@settlekit/marketplace-core";
import { toBaseUnits } from "@settlekit/common";
import { CouponService, InMemoryCouponStore, type CouponStore } from "@settlekit/coupons";
import {
  InvoiceService,
  InMemoryInvoiceStore,
  type InvoiceStore,
  type Merchant,
} from "@settlekit/invoices";
import { RefundService, InMemoryRefundStore, type RefundStore } from "@settlekit/refunds";
import { DunningService, InMemoryDunningStore, type DunningStore } from "@settlekit/dunning";
import { DisputeService, InMemoryDisputeStore, type DisputeStore } from "@settlekit/disputes";
import { PayoutService, InMemoryPayoutStore, type PayoutStore } from "@settlekit/payouts";
import { generateId } from "@settlekit/common";
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
import type { GitHubAccessClient } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import {
  InMemoryEntityStore, type EntityStore,
  seedDefaults,
  PgProductStore,
  PgPriceStore,
  PgCustomerStore,
  PgDeliveryRunStore,
  PgWebhookEndpointStore,
  PgWebhookEventStore,
  PgGitHubInstallationStore,
  PgGitHubRepoAccessGrantStore,
  PgDiscordConnectionStore,
  PgDiscordRoleGrantStore,
  PgCheckoutRepository,
  PgPaymentRepository,
  PgSubscriptionRepository,
  PgEntitlementRepository,
  PgApiKeyStore,
  PgLicenseStore,
  PgPlanStore,
  PgBundleStore,
  PgAgentServiceStore,
  PgAgentUsageStore,
  PgAgentReputationStore,
  PgSeatStore,
  PgGrantStore,
  PgEscrowStore,
  PgCouponStore,
  PgInvoiceStore,
  PgRefundStore,
  PgDunningStore,
  PgDisputeStore,
  PgPayoutStore,
  PgAuthStore,
  PgMarketplaceListingStore,
} from "@settlekit/persistence";
import { loadConfig } from "./config/env.js";
import { buildIntegrations } from "./config/integrations.js";
import type { DeliveryGrantSink } from "./wiring/delivery-clients.js";

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

  // GitHub integration (management routes). Real Octokit-backed client when
  // GitHub App creds are configured; the in-memory double otherwise.
  readonly githubClient: GitHubAccessClient;
  readonly githubInstallations: EntityStore<GitHubInstallation>;
  readonly githubGrants: EntityStore<GitHubRepoAccessGrant>;

  // Discord integration (management routes). Real fetch-backed bot when a bot
  // token is configured; the in-memory double otherwise.
  readonly discordApi: DiscordApi;
  readonly discordConnections: EntityStore<DiscordConnection>;
  readonly discordGrants: EntityStore<DiscordRoleGrant>;

  // SaaS / bundles / agent services / escrow.
  readonly saas: SaasService;
  readonly bundles: BundleService;
  readonly bundleStore: BundleStore;
  readonly agentServices: AgentServiceService;
  readonly agentServiceStore: AgentServiceStore;
  readonly escrow: EscrowService;

  // Public marketplace (product listings + discovery).
  readonly marketplace: MarketplaceService;
  readonly marketplaceListings: ListingStore;

  // Commerce engines: coupons (discounts) + invoices.
  readonly coupons: CouponService;
  readonly couponStore: CouponStore;
  readonly invoices: InvoiceService;
  readonly invoiceStore: InvoiceStore;
  /** Merchant identity used when rendering invoice HTML/text. */
  readonly merchant: Merchant;

  // Commerce engines: refunds, dunning, disputes, payouts.
  readonly refunds: RefundService;
  readonly refundStore: RefundStore;
  readonly dunning: DunningService;
  readonly dunningStore: DunningStore;
  readonly disputes: DisputeService;
  readonly disputeStore: DisputeStore;
  readonly payouts: PayoutService;
  readonly payoutStore: PayoutStore;
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

  // Prices store (named so the marketplace price resolver can read it).
  const prices = pick<EntityStore<Price>>(db, (d) => new PgPriceStore(d), () => new InMemoryEntityStore<Price>());

  // Public marketplace: discovery over the (Postgres or in-memory) listing store.
  // The price resolver looks up a listing's product price for price-sorted search.
  const marketplaceListings = pick<ListingStore>(db, (d) => new PgMarketplaceListingStore(d), () => new InMemoryListingStore());
  const marketplacePriceResolver: PriceResolver = {
    async priceBaseUnits(listing) {
      if (!listing.productId) return undefined;
      const productPrices = await prices.list((p) => p.productId === listing.productId);
      const first = productPrices[0];
      return first ? toBaseUnits(first.amount) : undefined;
    },
  };
  const marketplace = new MarketplaceService(marketplaceListings, marketplacePriceResolver);

  // GitHub / Discord grant stores: shared between the management routes and the
  // delivery grant sink so delivery-issued grants are persisted where the
  // access-sync / revocation routes read them.
  const githubGrants = pick<EntityStore<GitHubRepoAccessGrant>>(db, (d) => new PgGitHubRepoAccessGrantStore(d), () => new InMemoryEntityStore<GitHubRepoAccessGrant>());
  const discordGrants = pick<EntityStore<DiscordRoleGrant>>(db, (d) => new PgDiscordRoleGrantStore(d), () => new InMemoryEntityStore<DiscordRoleGrant>());

  // A DeliveryGrantSink backed by the (Postgres or in-memory) grant stores.
  const grantSink: DeliveryGrantSink = {
    async upsertGithubGrant(grant) {
      await githubGrants.save(grant);
    },
    async upsertDiscordGrant(grant) {
      await discordGrants.save(grant);
    },
    async findDiscordGrant(ref) {
      const matches = await discordGrants.list(
        (g) => g.guildId === ref.guildId && g.roleId === ref.roleId && g.discordUserId === ref.discordUserId,
      );
      return matches[0];
    },
  };

  // Built after the stores so delivery-issued license / API keys / file grants /
  // GitHub+Discord grants persist into the SAME stores the verify/list/sync
  // routes read.
  const integrations = buildIntegrations(config, {
    grantSink,
    licenseStore,
    apiKeyStore,
    fileGrantStore: grantStore,
  });

  // Commerce engines: Postgres-backed when DATABASE_URL is set, else in-memory.
  const couponStore = pick<CouponStore>(db, (d) => new PgCouponStore(d), () => new InMemoryCouponStore());
  const invoiceStore = pick<InvoiceStore>(db, (d) => new PgInvoiceStore(d), () => new InMemoryInvoiceStore());
  const refundStore = pick<RefundStore>(db, (d) => new PgRefundStore(d), () => new InMemoryRefundStore());
  const dunningStore = pick<DunningStore>(db, (d) => new PgDunningStore(d), () => new InMemoryDunningStore());
  const disputeStore = pick<DisputeStore>(db, (d) => new PgDisputeStore(d), () => new InMemoryDisputeStore());
  const payoutStore = pick<PayoutStore>(db, (d) => new PgPayoutStore(d), () => new InMemoryPayoutStore());
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
    prices,
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

    auth: new AuthService(pick<AuthStore>(db, (d) => new PgAuthStore(d), () => new InMemoryAuthStore())),
    authCookieSecret: config.authCookieSecret,

    arcVerifier: integrations.arcVerifier,
    circle: integrations.circle,
    email: integrations.email,

    githubClient: integrations.githubAccessClient,
    githubInstallations: pick<EntityStore<GitHubInstallation>>(db, (d) => new PgGitHubInstallationStore(d), () => new InMemoryEntityStore<GitHubInstallation>()),
    githubGrants,

    discordApi: integrations.discordApi,
    discordConnections: pick<EntityStore<DiscordConnection>>(db, (d) => new PgDiscordConnectionStore(d), () => new InMemoryEntityStore<DiscordConnection>()),
    discordGrants,

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

    marketplace,
    marketplaceListings,

    coupons: new CouponService(couponStore),
    couponStore,
    invoices: new InvoiceService(invoiceStore),
    invoiceStore,
    merchant,

    refunds: new RefundService(refundStore, () => generateId("payment")),
    refundStore,
    dunning: new DunningService(dunningStore),
    dunningStore,
    disputes: new DisputeService(
      disputeStore,
      () => generateId("payment"),
      () => generateId("payment"),
    ),
    disputeStore,
    payouts: new PayoutService(payoutStore, () => generateId("payoutWallet")),
    payoutStore,
  };
}

/** Hono `Variables` binding: the context is attached to every request. */
export interface AppEnv {
  Variables: {
    ctx: AppContext;
    apiKeyId?: string;
  };
}
