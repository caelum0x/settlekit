/**
 * Application context: builds the real service singletons the routes depend on.
 *
 * Every service is wired to the in-memory repositories the @settlekit packages
 * ship, so the API runs fully end-to-end with no external infrastructure. When
 * `DATABASE_URL` is set, a real drizzle `Database` handle is created via
 * `@settlekit/database` and exposed on the context (routes can opt into it).
 *
 * The context is constructed once at startup and shared (read-only) across all
 * requests. State lives inside the repositories, not in the route modules.
 */
import { createDb, type Database } from "@settlekit/database";
import {
  EntitlementService,
  InMemoryEntitlementRepository,
} from "@settlekit/entitlements";
import {
  InMemoryCheckoutRepository,
  InMemoryPaymentRepository,
  InMemorySubscriptionRepository,
} from "@settlekit/payments";
import { ApiKeyService, InMemoryApiKeyStore } from "@settlekit/api-keys";
import { LicenseService, InMemoryLicenseStore } from "@settlekit/license-keys";
import {
  SaasService,
  InMemoryPlanStore,
  InMemorySeatStore,
} from "@settlekit/saas";
import { BundleService, InMemoryBundleStore, type BundleStore } from "@settlekit/bundles";
import {
  AgentServiceService,
  InMemoryAgentServiceStore,
  InMemoryAgentUsageStore,
  InMemoryAgentReputationStore,
  type AgentServiceStore,
} from "@settlekit/agent-services";
import { EscrowService, InMemoryEscrowStore } from "@settlekit/escrow";
import { FileDeliveryService, InMemoryGrantStore } from "@settlekit/file-delivery";
import {
  createDefaultRegistry,
  type DeliveryClients,
  type HandlerRegistry,
} from "@settlekit/delivery";
import { createInMemoryDeliveryClients } from "./clients/in-memory-delivery-clients.js";
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
import { RecordStore } from "./stores/record-store.js";
import { InMemoryGitHubAccessClient } from "./clients/in-memory-github-client.js";
import { InMemoryDiscordApi } from "./clients/in-memory-discord-client.js";

/** Secret used by the license-keys service for offline validation tokens. */
const LICENSE_TOKEN_SECRET =
  process.env.LICENSE_TOKEN_SECRET ?? "settlekit-dev-license-secret";

/** The fully-wired set of services + stores shared across requests. */
export interface AppContext {
  /** Optional real drizzle database handle (only when DATABASE_URL is set). */
  readonly db: Database | null;

  // Core commerce repositories (in-memory, real implementations).
  readonly checkouts: InMemoryCheckoutRepository;
  readonly payments: InMemoryPaymentRepository;
  readonly subscriptions: InMemorySubscriptionRepository;
  readonly entitlementRepo: InMemoryEntitlementRepository;
  readonly entitlements: EntitlementService;

  // Resource stores without a packaged store.
  readonly products: RecordStore<Product>;
  readonly prices: RecordStore<Price>;
  readonly customers: RecordStore<Customer>;
  readonly deliveryRuns: RecordStore<DeliveryRun>;
  /** Pre-loaded registry of every built-in delivery action handler. */
  readonly deliveryRegistry: HandlerRegistry;
  /** In-process clients the delivery handlers execute against. */
  readonly deliveryClients: DeliveryClients;
  readonly webhookEndpoints: RecordStore<WebhookEndpoint>;
  readonly webhookEvents: RecordStore<WebhookEvent>;

  // Access / key services.
  readonly apiKeys: ApiKeyService;
  readonly licenses: LicenseService;
  readonly files: FileDeliveryService;

  // GitHub integration.
  readonly githubClient: InMemoryGitHubAccessClient;
  readonly githubInstallations: RecordStore<GitHubInstallation>;
  readonly githubGrants: RecordStore<GitHubRepoAccessGrant>;

  // Discord integration.
  readonly discordApi: InMemoryDiscordApi;
  readonly discordConnections: RecordStore<DiscordConnection>;
  readonly discordGrants: RecordStore<DiscordRoleGrant>;

  // SaaS / bundles / agent services / escrow.
  readonly saas: SaasService;
  readonly bundles: BundleService;
  /** Direct handle to the bundle store for field edits the service does not cover. */
  readonly bundleStore: BundleStore;
  readonly agentServices: AgentServiceService;
  /** Direct handle to the agent service store for PATCH field edits. */
  readonly agentServiceStore: AgentServiceStore;
  readonly escrow: EscrowService;
}

/** Build the singleton {@link AppContext}, wiring every service + store. */
export function createContext(): AppContext {
  const db = process.env.DATABASE_URL ? createDb(process.env.DATABASE_URL) : null;

  const entitlementRepo = new InMemoryEntitlementRepository();
  const products = new RecordStore<Product>();
  const bundleStore = new InMemoryBundleStore();
  const agentServiceStore = new InMemoryAgentServiceStore();

  return {
    db,

    checkouts: new InMemoryCheckoutRepository(),
    payments: new InMemoryPaymentRepository(),
    subscriptions: new InMemorySubscriptionRepository(),
    entitlementRepo,
    entitlements: new EntitlementService(entitlementRepo),

    products,
    prices: new RecordStore<Price>(),
    customers: new RecordStore<Customer>(),
    deliveryRuns: new RecordStore<DeliveryRun>(),
    deliveryRegistry: createDefaultRegistry(),
    deliveryClients: createInMemoryDeliveryClients(),
    webhookEndpoints: new RecordStore<WebhookEndpoint>(),
    webhookEvents: new RecordStore<WebhookEvent>(),

    apiKeys: new ApiKeyService(new InMemoryApiKeyStore()),
    licenses: new LicenseService(new InMemoryLicenseStore(), {
      tokenSecret: LICENSE_TOKEN_SECRET,
    }),
    files: new FileDeliveryService(new InMemoryGrantStore(), {
      baseUrl: process.env.FILE_DOWNLOAD_BASE_URL ?? "http://localhost:8787/v1/files/download",
      secret: process.env.FILE_DOWNLOAD_SECRET ?? "settlekit-dev-file-secret",
      defaultExpiresInSec: 3600,
      defaultMaxDownloads: 3,
    }),

    githubClient: new InMemoryGitHubAccessClient(),
    githubInstallations: new RecordStore<GitHubInstallation>(),
    githubGrants: new RecordStore<GitHubRepoAccessGrant>(),

    discordApi: new InMemoryDiscordApi(),
    discordConnections: new RecordStore<DiscordConnection>(),
    discordGrants: new RecordStore<DiscordRoleGrant>(),

    saas: new SaasService({
      plans: new InMemoryPlanStore(),
      seats: new InMemorySeatStore(),
    }),
    bundles: new BundleService(
      bundleStore,
      // A bundle may reference any product that exists in our product store.
      (productId: string) => products.findById(productId) !== null,
    ),
    bundleStore,
    agentServices: new AgentServiceService({
      services: agentServiceStore,
      usage: new InMemoryAgentUsageStore(),
      reputation: new InMemoryAgentReputationStore(),
    }),
    agentServiceStore,
    escrow: new EscrowService(new InMemoryEscrowStore()),
  };
}

/** Hono `Variables` binding: the context is attached to every request. */
export interface AppEnv {
  Variables: {
    ctx: AppContext;
    /** The API key id the request authenticated with (set by auth middleware). */
    apiKeyId?: string;
  };
}
