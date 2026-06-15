export const meta = {
  name: 'settlekit-pg-wiring',
  description: 'Postgres adapters + integration/secrets config for apps/api (no tests)',
  phases: [{ title: 'Wiring' }],
};

const REFERENCE = `
REFERENCE PATTERN (already in the repo, build-verified — COPY IT EXACTLY):

EntityStore adapter — /Users/arhansubasi/settlekit/apps/api/src/db/pg/products-store.ts:
  import { eq, type Database, products } from "@settlekit/database";
  import type { Product } from "@settlekit/common";
  import type { EntityStore } from "../entity-store.js";
  import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
  import { DEFAULT_MERCHANT_ID } from "../seed.js";
  export class PgProductStore implements EntityStore<Product> {
    constructor(private readonly db: Database) {}
    async save(entity) { const projection = { <typed NOT-NULL columns from entity>, metadata: packDoc(entity) };
      await this.db.insert(products).values({ id: entity.id, ...projection }).onConflictDoUpdate({ target: products.id, set: projection }); return entity; }
    async findById(id) { const rows = await this.db.select({ metadata: products.metadata }).from(products).where(eq(products.id,id)).limit(1); return unpackDoc<Product>(rows[0]); }
    async list(p) { const rows = await this.db.select({ metadata: products.metadata }).from(products); const all = unpackDocs<Product>(rows); return p ? all.filter(p) : all; }
    async delete(id) { const res = await this.db.delete(products).where(eq(products.id,id)).returning({ id: products.id }); return res.length>0; }
  }

Packaged-interface adapter — /Users/arhansubasi/settlekit/apps/api/src/db/pg/checkout-repository.ts:
  implements CheckoutRepository from @settlekit/payments; same packDoc/unpackDoc/unpackDocs + projection + onConflictDoUpdate approach; extra finders (findByCustomerId) select where eq(table.customerId, x) then unpackDocs.

RULES:
- import { eq, type Database, <tableConsts> } from "@settlekit/database" (NEVER import drizzle-orm directly — apps/api has no direct dep on it; eq is re-exported by @settlekit/database).
- The canonical entity ALWAYS goes in metadata via packDoc(entity); reads ALWAYS reconstruct via unpackDoc/unpackDocs (metadata.__doc is the source of truth).
- Projections fill every NOT NULL column. For a NOT NULL merchant_id / organization_id the domain object lacks, use DEFAULT_MERCHANT_ID (from ../seed.js) / DEFAULT_ORG_ID. Map domain ISO timestamp strings to Date for timestamptz columns (new Date(iso)). Money -> { amount, currency } columns. jsonb columns: pass the JS array/object.
- READ the exact column names + which are NOT NULL from /Users/arhansubasi/settlekit/packages/database/src/schema/*.ts before writing each adapter.
- ESM, .js relative imports, import type for types, files <400 lines. NO tests, NO vitest, NO test scripts. Do NOT run a build (parallel builds race) — just write correct code matching the reference.
- Create ONLY files under /Users/arhansubasi/settlekit/apps/api/src/. Do not edit context.ts (the rewire is handled separately).
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: { unit: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
};

const TASKS = [
  {
    label: 'pg-entity-stores',
    prompt: `Write Postgres EntityStore adapters under /Users/arhansubasi/settlekit/apps/api/src/db/pg/, one file per resource, each a class implementing EntityStore<T> exactly like the PgProductStore reference. Resources + their @settlekit/database table const + domain type (from @settlekit/common):
- prices-store.ts: table \`prices\`, type Price (project: productId, currency=entity.currency, unitAmount=entity.unitAmount ?? entity.amount, interval=entity.interval, active=entity.active).
- customers-store.ts: table \`customers\`, type Customer (project: merchantId=entity.merchantId||DEFAULT_MERCHANT_ID, email, name=entity.name??null, walletAddress=entity.walletAddress??null). NOTE: Customer domain may carry organizationId not merchantId — read the table; merchant_id is NOT NULL so use DEFAULT_MERCHANT_ID when absent.
- delivery-runs-store.ts: table \`deliveryRuns\` (delivery_runs), type DeliveryRun (read columns; project status, paymentId, customerId, deliveryPlanId, organizationId mapping as the columns require).
- webhook-endpoints-store.ts: table \`webhookEndpoints\`, type WebhookEndpoint.
- webhook-events-store.ts: table \`webhookEvents\`, type WebhookEvent.
- github-installations-store.ts: table \`githubInstallations\`, type GitHubInstallation.
- github-grants-store.ts: table \`githubRepoAccessGrants\` (github_repo_access_grants), type GitHubRepoAccessGrant.
- discord-connections-store.ts: table \`discordConnections\`, type DiscordConnection.
- discord-grants-store.ts: table \`discordRoleGrants\` (discord_role_grants), type DiscordRoleGrant.
For each: READ packages/database/src/schema/{catalog,accounts,payments,delivery,webhooks,github,discord}.ts to get exact column names + NOT NULL set, and READ packages/common/src/types/*.ts for the domain field names. Follow the reference precisely.`,
  },
  {
    label: 'pg-repos',
    prompt: `Write Postgres adapters for the packaged store interfaces under /Users/arhansubasi/settlekit/apps/api/src/db/pg/, each implementing the package interface exactly like the PgCheckoutRepository reference:
- payment-repository.ts: PgPaymentRepository implements PaymentRepository (@settlekit/payments) — table \`payments\`. Methods findById/save + findByCheckoutSessionId(eq checkout_session_id) + findByTxHash(eq tx_hash). merchant_id is NOT NULL but Payment has no merchantId -> use DEFAULT_MERCHANT_ID. Project status, network, currency=amount.currency, amount=amount.amount, txHash=entity.txHash??null.
- subscription-repository.ts: PgSubscriptionRepository implements SubscriptionRepository — table \`subscriptions\`. findById/save + findByCustomerId. NOT NULL merchant_id -> DEFAULT_MERCHANT_ID; current_period_start/end are requiredTimestamp -> new Date(entity.currentPeriodStart/End); priceId, customerId, status, cancelAtPeriodEnd.
- entitlement-repository.ts: PgEntitlementRepository implements EntitlementRepository (@settlekit/entitlements) — table \`entitlements\`. Methods: findActiveByCustomerProduct(customerId,productId) (filter by columns + status active, then unpackDocs and pick first active), findById, save, listByCustomer(customerId, options?) (options may include activeOnly/type — read the ListByCustomerOptions interface). NOT NULL merchant_id -> DEFAULT_MERCHANT_ID; project customerId, productId=entity.productId??null, type=entity.entitlementType, status, expiresAt=entity.expiresAt? new Date(...):null.
- license-store.ts: PgLicenseStore implements LicenseStore (@settlekit/license-keys) — table \`licenseKeys\`. save/findById/findByKey(eq key)/listByCustomer. Read columns.
- api-key-store.ts: PgApiKeyStore implements ApiKeyStore (@settlekit/api-keys) — table \`apiKeys\`. findByHash(eq key_hash)/save (save returns Promise<void>). Read columns (key_hash, key_prefix, scopes jsonb, status...).
- plan-store.ts: PgPlanStore implements PlanStore (@settlekit/saas) — table \`saasPlans\`. save/findById/list({productId?})/delete (delete returns Result<true,SettleKitError>; import ok/err + SettleKitError from @settlekit/common, return ok(true)). Read saas.ts columns.
- bundle-store.ts: PgBundleStore implements BundleStore (@settlekit/bundles) — table \`bundles\`. findById/save/list(ListBundlesOptions)/delete(boolean). NOT NULL merchant_id -> entity.merchantId||DEFAULT_MERCHANT_ID; total_amount=entity.price.amount; currency=entity.price.currency; status.
- agent-service-store.ts: PgAgentServiceStore implements AgentServiceStore (@settlekit/agent-services) — table \`agentServices\`. save/findById/listByOrganization(eq organization_id)/listAll. Read agents.ts columns (NOT NULL: organization_id, merchant_id? product_id? name, endpoint, price...). Use DEFAULT_* where domain lacks a value.
For EACH: READ the package interface file (packages/<pkg>/src/store.ts or repositories.ts or repository.ts) for the EXACT method signatures, and READ the matching packages/database/src/schema/*.ts for columns + NOT NULL. Follow the reference precisely. Do NOT implement stores that have no backing table.`,
  },
  {
    label: 'api-config',
    prompt: `Build the real integration-config / secrets layer for apps/api. Mirror the existing worker implementation — READ /Users/arhansubasi/settlekit/apps/worker/src/config.ts AND /Users/arhansubasi/settlekit/apps/worker/src/wiring/delivery-clients.ts first; reuse their shapes.
Create:
- /Users/arhansubasi/settlekit/apps/api/src/config/env.ts: loadConfig() reading process.env into a typed ApiConfig. Groups (each OPTIONAL — the API must still boot with none set): database (DATABASE_URL?), arc (ARC_RPC_URL, ARC_USDC_ADDRESS, ARC_CHAIN_ID, ARC_MIN_CONFIRMATIONS?), circle (CIRCLE_API_KEY, CIRCLE_BASE_URL?), github (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID, GITHUB_WEBHOOK_SECRET?), discord (DISCORD_BOT_TOKEN), email (RESEND_API_KEY, EMAIL_FROM), s3 (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_ENDPOINT?), plus always-present: port (PORT default 8787), licenseTokenSecret (LICENSE_TOKEN_SECRET default dev), webhookSigningSecret (WEBHOOK_SIGNING_SECRET default dev), fileDelivery (FILE_DOWNLOAD_BASE_URL, FILE_DOWNLOAD_SECRET, defaults). Export boolean flags hasDatabase/hasArc/hasCircle/hasGithub/hasDiscord/hasEmail/hasS3. Throw a clear ConfigError when a group is PARTIALLY set (e.g. GITHUB_APP_ID without GITHUB_APP_PRIVATE_KEY). Use isArcAddress from @settlekit/arc to validate the USDC address. No console.log.
- /Users/arhansubasi/settlekit/apps/api/src/config/integrations.ts: buildIntegrations(config) returning { deliveryClients: DeliveryClients, githubAccessClient, discordApi, arcVerifier: PaymentVerifier|null, circle|null, email|null }. When the relevant creds are present, construct the REAL clients: GitHub via @settlekit/github createGitHubAppClient({appId,privateKey,installationId}) + createGitHubAccessClient; Discord via @settlekit/discord createDiscordClient({botToken}); Arc via @settlekit/arc createArcClient({rpcUrl,usdcAddress,chainId}) and an x402 PaymentVerifier that calls verifyUsdcTransfer; Circle via @settlekit/circle createCircleClient; email via @settlekit/notifications createEmailClient. Build deliveryClients EXACTLY like the worker's createDeliveryClients (copy that adapter logic into apps/api/src/wiring/delivery-clients.ts), choosing real github/discord transports when configured. When creds are absent, FALL BACK to the existing in-memory clients already in apps/api/src/clients/ (InMemoryGitHubAccessClient, InMemoryDiscordApi, createInMemoryDeliveryClients). Persisting grants: the worker writes to WorkerStores; for the API, accept injected upsert callbacks or use simple in-memory maps inside the adapter — keep it real and compiling.
- /Users/arhansubasi/settlekit/apps/api/src/wiring/delivery-clients.ts: the real createDeliveryClients(deps) adapted from the worker (same 8 adapters), parameterized by injected GitHubApi + DiscordApi + secrets.
Do NOT edit context.ts. READ the @settlekit/github, /discord, /arc, /circle, /notifications, /x402 package src/index.ts for exact export names before importing. Files <400 lines. No tests.`,
  },
];

phase('Wiring');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${REFERENCE}`, { label: t.label, phase: 'Wiring', schema: MANIFEST }))
);
log(`Wiring: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
