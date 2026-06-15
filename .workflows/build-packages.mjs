export const meta = {
  name: 'settlekit-build-packages',
  description: 'Build all 21 SettleKit packages with real implementations (no stubs)',
  phases: [
    { title: 'Foundation' },
    { title: 'Domain' },
  ],
};

// ---------------------------------------------------------------------------
// Shared spec handed to every package agent so output is mutually consistent.
// ---------------------------------------------------------------------------

const CONVENTIONS = `
PACKAGE CONVENTIONS (follow exactly):
- Create ONLY files under packages/<name>/. Never touch root config or other packages.
- TypeScript ESM. tsconfig.base.json uses NodeNext + verbatimModuleSyntax + strict + noUncheckedIndexedAccess.
  => Every RELATIVE import MUST end in .js (e.g. import { foo } from "./foo.js").
  => Type-only imports MUST use 'import type { X }'.
  => Imports from "@settlekit/common" do NOT need a .js suffix.
- packages/<name>/package.json:
  {
    "name": "@settlekit/<name>", "version": "0.0.0", "type": "module",
    "main": "./dist/index.js", "types": "./dist/index.d.ts",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
    "files": ["dist"],
    "scripts": { "build": "tsc -b", "test": "vitest run" },
    "dependencies": { "@settlekit/common": "workspace:*", ...realNpmDeps },
    "devDependencies": { "@types/node": "^20.14.0", "typescript": "^5.5.4", "vitest": "^2.0.5" }
  }
  Pin real npm deps to a known-good caret version (you choose a real published version).
- packages/<name>/tsconfig.json:
  {
    "extends": "../../tsconfig.base.json",
    "compilerOptions": { "rootDir": "./src", "outDir": "./dist", "composite": true },
    "references": [{ "path": "../common" }],
    "include": ["src/**/*"],
    "exclude": ["dist", "node_modules", "**/*.test.ts"]
  }
- src/index.ts re-exports the package's public API.
- Tests go in packages/<name>/test/*.test.ts using vitest (describe/it/expect).

HARD CONSTRAINTS (the user explicitly demanded this):
- REAL code only. NO mocks, NO stubs, NO placeholders, NO "TODO", NO throw new Error("not implemented").
- Production code calls REAL SDKs / REAL HTTP APIs with correct request/response shapes.
- Where an external service client is needed, define a narrow TS interface for it AND ship a REAL
  default implementation that uses the real SDK/REST API. Tests may construct an in-memory
  implementation of that interface to drive pure domain logic (this is allowed — it is a real
  test double of YOUR interface, not a fake of the product behaviour).
- Every exported function must be fully implemented and correct.
- Keep files focused (<400 lines). Many small files over few large ones.
- ONLY depend on @settlekit/common plus real third-party npm packages. Do NOT import other @settlekit/* packages.
`;

const COMMON_API = `
@settlekit/common EXPORTS you can import:
- ids: generateId(resource: ResourceName), isId, uuid(), generateSecret(bytes?), ID_PREFIXES, type ResourceName
  (ResourceName keys include: organization,user,merchant,customer,product,price,bundle,checkoutSession,payment,
   subscription,usageMeter,creditBalance,entitlement,deliveryPlan,deliveryRun,deliveryAction,licenseKey,apiKey,
   githubInstallation,githubRepoAccess,discordRoleAccess,fileAsset,webhookEndpoint,webhookEvent,marketplaceListing,
   agentService,escrowTask,payoutWallet,riskProfile)
- money: type Money {amount:string;currency:"USDC"}, money(amount,currency?), toBaseUnits, fromBaseUnits,
  normalizeAmount, addMoney, subtractMoney, multiplyMoney, compareMoney, isZero, USDC_DECIMALS, USDC_SCALE, type Currency
- result: type Result<T,E>, ok(), err(), isOk, isErr, unwrap, class SettleKitError({code,message,httpStatus?,retryable?,details?,cause?}),
  type ErrorCode (validation_error|not_found|conflict|unauthorized|forbidden|rate_limited|payment_required|payment_failed|
  integration_error|delivery_failed|insufficient_credits|entitlement_expired|internal_error), validationError, notFound, conflict
- time: type IsoTimestamp, toIso(Date), addDays, addMonths, addYears, isPast, periodEnd(start,"monthly"|"yearly")
- product types: ProductType, ProductStatus, DeliveryMode, Product, PriceInterval, Price, Bundle, FileAsset
- customer types: Organization, UserRole, User, Merchant, Customer, PayoutWallet
- payment types: PaymentNetwork, CheckoutSessionStatus, CheckoutLineItem, CheckoutSession, PaymentStatus, Payment,
  SubscriptionStatus, Subscription, UsageMeter, CreditBalance
- entitlement types: EntitlementType, EntitlementStatus, Entitlement, LicenseKey, ApiKey
- delivery types: DeliveryAction (discriminated union by .type), DeliveryActionType, DeliveryPlan, DeliveryRunStatus,
  DeliveryActionStatus, DeliveryActionRun, DeliveryRun, DeliveryLog
- integration types: GitHubInstallation, GitHubRepoAccessGrant, DiscordConnection, DiscordRoleGrant, WebhookEventType,
  WebhookEndpoint, WebhookEvent, AgentService, EscrowStatus, EscrowTask, MarketplaceListing, RiskProfile
`;

const MANIFEST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['package', 'files', 'npmDeps', 'summary'],
  properties: {
    package: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    npmDeps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Package specs
// ---------------------------------------------------------------------------

const PACKAGES = [
  // -------------------------- FOUNDATION --------------------------
  {
    phase: 'Foundation', name: 'database', deps: 'drizzle-orm, postgres (postgres-js driver)',
    brief: `Persistence layer for the whole platform using drizzle-orm + the "postgres" (postgres-js) driver.
Implement REAL Drizzle pgTable schemas for every entity in plan §15 and the additions in §25:
organizations, users, merchants, customers, payout_wallets, products, prices, bundles, bundle_items,
checkout_sessions, payments, subscriptions, usage_meters, credit_balances, entitlements, license_keys, api_keys,
delivery_plans, delivery_runs, delivery_actions, delivery_logs, file_assets, webhook_endpoints, webhook_events,
github_installations, github_repositories, github_teams, github_repo_access_grants, github_access_sync_runs,
discord_connections, discord_guilds, discord_roles, discord_role_grants,
saas_plans, saas_features, saas_seats, saas_entitlement_rules,
agent_services, agent_service_metadata, agent_buyers, agent_usage_events,
escrow_tasks, escrow_fundings, escrow_submissions, escrow_releases, escrow_disputes,
marketplace_listings, risk_profiles.
Files: src/schema/*.ts (one file per domain group), src/schema/index.ts (re-export all tables),
src/client.ts (createDb(connectionString) returning drizzle(postgres(connectionString)) with the schema),
src/migrate.ts (programmatic migrate using drizzle-orm/postgres-js/migrator), src/index.ts.
Also a generic Repository<T> helper interface in src/repository.ts with findById/findMany/insert/update/delete typed against tables.
Use proper column types: text ids (primary keys), timestamp with timezone, jsonb for metadata/features, numeric for amounts stored as text, integer, boolean. Add indexes on foreign keys.
Tests: a test that builds the drizzle schema object and asserts table/column presence (no live DB needed — import tables and assert .name / columns).`,
  },
  {
    phase: 'Foundation', name: 'payments', deps: 'none beyond common',
    brief: `Core checkout + payment state machine (plan §15, Phase 1). Pure domain logic + repository interfaces (no DB import).
Implement: createCheckoutSession(input) -> CheckoutSession (computes total Money from line items + prices, sets expiresAt, payToAddress, status "open"); collectFields; expireSession.
Payment lifecycle: recordPendingPayment, confirmPayment(payment, txHash, confirmations) with a min-confirmations rule, failPayment, refundPayment — each returns a NEW immutable object (never mutate).
Subscription lifecycle: createSubscription(price, start), renewSubscription (advance period via common periodEnd), enterGrace, cancel, expire.
Define repository interfaces: CheckoutRepository, PaymentRepository, SubscriptionRepository (findById/save). Ship an in-memory implementation in src/in-memory-repositories.ts that is REAL (a working Map-backed store usable in dev/tests).
Files: src/checkout.ts, src/payment-lifecycle.ts, src/subscription-lifecycle.ts, src/repositories.ts, src/in-memory-repositories.ts, src/index.ts.
Tests: checkout total math, confirm requires confirmations, refund transitions, subscription renew advances period, grace logic.`,
  },
  {
    phase: 'Foundation', name: 'arc', deps: 'viem',
    brief: `Arc network (EVM USDC) settlement verification using viem. REAL on-chain reads.
Implement createArcClient({ rpcUrl, usdcAddress, chainId }) returning a client wrapping viem's createPublicClient(http(rpcUrl)).
Methods: getTransactionReceipt(txHash); verifyUsdcTransfer({ txHash, to, minAmount }) -> decodes ERC-20 Transfer logs (event Transfer(address indexed from,address indexed to,uint256 value)) from the receipt using viem decodeEventLog/parseAbiItem, confirms a transfer to 'to' of >= minAmount (USDC 6 decimals via common toBaseUnits), returns { confirmed, from, amount, confirmations }; getConfirmations(txHash) using getBlockNumber - receipt.blockNumber; waitForConfirmations.
Provide ARC_USDC ABI (transfer/balanceOf/Transfer event) in src/usdc-abi.ts.
Files: src/arc-client.ts, src/usdc-abi.ts, src/types.ts, src/index.ts.
Tests: decode a real ERC-20 Transfer log fixture (hex topics/data) and assert the parsed to/value; amount comparison via common money helpers. (Construct an in-memory implementation of the RPC transport interface that returns a canned receipt — drive the real decoding logic.)`,
  },
  {
    phase: 'Foundation', name: 'circle', deps: 'none (REST via fetch)',
    brief: `Circle integration (Gateway / Web3 Services) via REAL REST calls using global fetch.
Implement createCircleClient({ apiKey, baseUrl = "https://api.circle.com" }).
Methods (real Circle REST shapes, Authorization: Bearer apiKey, JSON):
- createPaymentIntent({ amount, currency:"USD"/"USDC", settlementCurrency, chain }) POST /v1/paymentIntents
- getPaymentIntent(id) GET /v1/paymentIntents/:id
- createPayout / getPayout for merchant settlement
- listTransfers
Wrap all responses; on non-2xx throw SettleKitError({ code:"integration_error" }) with the Circle error body in details. Parse and normalize amounts with common Money.
Provide a typed CircleHttp interface (request method) with a real fetch-based default impl, so tests can drive logic with an in-memory CircleHttp returning canned JSON.
Files: src/circle-client.ts, src/http.ts, src/types.ts, src/index.ts.
Tests: builds request with correct method/url/headers/body; maps error body to SettleKitError; normalizes amounts.`,
  },
  {
    phase: 'Foundation', name: 'x402', deps: 'none (web standard Request/Response)',
    brief: `x402 "HTTP 402 pay-per-call" protocol middleware (plan §5). Framework-agnostic using the web Fetch API (Request/Response).
Implement buildPaymentRequiredResponse({ price, currency:"USDC", network, payTo, productId, resource }) -> a 402 Response with an "Accept-Payment" / "X-Payment-Required" JSON body describing the payment requirements (scheme x402, amount, asset USDC, network, payTo address, nonce).
Implement parsePaymentHeader(req) reading the "X-Payment" header (base64 JSON: { txHash, from, amount, network, nonce }).
Implement withSettleKitPayment({ price, currency, productId, network, payTo, verify })(handler): returns an async (req: Request) => Response that:
  1. reads X-Payment; if absent -> return buildPaymentRequiredResponse
  2. calls the injected verify(payment) -> Promise<{ ok: boolean; reason?: string }> (verify is supplied by the host and will use @settlekit/arc/circle in the app — define the interface here)
  3. on success runs handler(req); on failure returns 402 with reason.
Also a settleAndMeter hook callback for usage recording.
Files: src/payment-required.ts, src/payment-header.ts, src/middleware.ts, src/types.ts, src/index.ts.
Tests: missing header -> 402 with correct JSON; valid header + passing verify -> handler runs; failing verify -> 402. Use real Request/Response objects.`,
  },
  {
    phase: 'Foundation', name: 'webhooks', deps: 'none (node:crypto + fetch)',
    brief: `Outbound webhook delivery with HMAC signing + verification (plan §15 WebhookEndpoint).
Implement signPayload(secret, payloadJson, timestamp) using node:crypto HMAC-SHA256 -> "t=<ts>,v1=<hex>" (Stripe-style).
verifySignature(secret, payloadJson, header, toleranceSec) constant-time compare (crypto.timingSafeEqual).
deliverWebhook({ endpoint, event }) using fetch POST with headers: 'SettleKit-Signature', 'SettleKit-Event', content-type json; returns { status, ok }.
deliverWithRetry with exponential backoff schedule (e.g. [0,1,5,25,125]s) returning attempts; expose the schedule as data so a worker can persist it (the function itself should accept an injected sleep + clock for determinism but default to real timers).
buildWebhookEvent(type, data) -> WebhookEvent with generated id.
Files: src/signing.ts, src/delivery.ts, src/events.ts, src/types.ts, src/index.ts.
Tests: sign/verify round trip; tampered payload fails; retry stops after success; backoff schedule correct. Use an in-memory fetch-like sender interface to drive retry logic.`,
  },
  {
    phase: 'Foundation', name: 'notifications', deps: 'none (Resend REST via fetch)',
    brief: `Transactional email + receipts. REAL email send via Resend REST API (https://api.resend.com/emails) using fetch + Bearer apiKey.
Implement createEmailClient({ apiKey, from }) with send({ to, subject, html, text }).
Receipt rendering: renderReceiptHtml(payment, lineItems, merchant) and renderReceiptText(...) producing real HTML/text receipts (amount via common Money).
Delivery instruction emails: renderAccessGrantedEmail({ customer, entitlements }) listing what they got (github invite link, license key, download link, discord, api key).
Define EmailTransport interface; real ResendTransport default; tests use in-memory transport.
Files: src/email-client.ts, src/transports.ts, src/receipts.ts, src/templates.ts, src/index.ts.
Tests: receipt html contains amount + line items; resend transport builds correct request; access-granted email lists each entitlement.`,
  },
  {
    phase: 'Foundation', name: 'risk', deps: 'none',
    brief: `Risk scoring engine (plan §15 RiskProfile, §33 Phase 6). Pure rules engine.
Implement a RuleEngine: define Rule = { id, weight, evaluate(ctx) -> { hit: boolean; reason?: string } }.
Provide real rules: highVelocity (too many checkouts/payments in window), newAccountLargeAmount, refundAbuse, mismatchedGeo/wallet reuse, chargebackHistory.
scoreTransaction(ctx) -> RiskProfile { score 0..100 (weighted sum, clamped), flags: reasons }.
decide(score) -> "allow" | "review" | "block" by thresholds.
Files: src/rules.ts, src/engine.ts, src/score.ts, src/types.ts, src/index.ts.
Tests: clean ctx scores low/allow; multiple hits raise score + flags; clamps at 100; thresholds map correctly.`,
  },

  // -------------------------- DOMAIN --------------------------
  {
    phase: 'Domain', name: 'entitlements', deps: 'none beyond common',
    brief: `THE CORE ENGINE (plan §14). Universal entitlements. Pure logic + repository interface.
Implement grantFromPayment({ payment, product, deliveryAction, expiresAt? }) -> Entitlement (entitlementType derived from the DeliveryAction/product type; status "active").
grantFromSubscription(...).
verifyFeature(entitlement, feature) -> { allowed: boolean; reason? } reading entitlement.features (boolean true OR numeric limit > 0).
verifyCredits(entitlement, amount) and deductCredits(entitlement, amount) -> new Entitlement (immutable; throws SettleKitError insufficient_credits when short).
checkSeat(entitlement, usedSeats).
isActive(entitlement, now) accounting for status + expiresAt (uses common isPast).
expireDue(entitlements, now) -> list to expire.
revoke(entitlement, reason) -> new Entitlement status "revoked".
EntitlementRepository interface (findActiveByCustomerProduct, save, listByCustomer) + REAL in-memory impl.
A high-level EntitlementService that ties repo + logic: verify({customerId,feature}) like the SDK example in plan §4.
Files: src/grant.ts, src/verify.ts, src/credits.ts, src/lifecycle.ts, src/repository.ts, src/in-memory-repository.ts, src/service.ts, src/index.ts.
Tests: grant from payment; feature allow/deny; credit deduction + insufficient; expiry; revoke; seat checks; service.verify end to end.`,
  },
  {
    phase: 'Domain', name: 'delivery', deps: 'none beyond common',
    brief: `THE ACTION ENGINE (plan §21). Runs after payment: one payment -> many actions, with retry + rollback.
Define ActionHandler interface: { type: DeliveryActionType; execute(action, ctx) -> Promise<output>; rollback?(action, output, ctx) -> Promise<void> }.
Implement a HandlerRegistry (register/get).
DeliveryRunner.run(plan, ctx) -> DeliveryRun: executes actions in order, records DeliveryActionRun status/attempts/output, retries each failed action with backoff up to maxAttempts, on unrecoverable failure marks run partially_failed/failed and rolls back already-succeeded actions (best effort). Immutable run objects (return new run snapshots) + emit DeliveryLog entries via an injected logger.
retryRun(run, registry, ctx) re-runs only failed actions.
Provide REAL handler skeletons that call INJECTED clients (the concrete github/discord/etc clients are wired by the app, NOT imported here): define the client interfaces (GithubAccessClient, DiscordRoleClient, LicenseIssuer, ApiKeyIssuer, FileGrantor, SaasEntitler, WebhookSender, EmailSender) in src/clients.ts and implement handlers in src/handlers/*.ts that use them. These handlers contain REAL logic (build the grant, call client.invite(...), shape output) — they are not stubs.
Files: src/runner.ts, src/registry.ts, src/retry.ts, src/clients.ts, src/handlers/grant-github-repo.ts, grant-github-team.ts, issue-license-key.ts, issue-api-key.ts, grant-file-access.ts, grant-discord-role.ts, create-saas-entitlement.ts, send-webhook.ts, send-email.ts, src/index.ts.
Tests: runner executes all actions; a failing action retries then rolls back prior ones; retryRun reruns only failed; registry dispatch. Use in-memory implementations of the client interfaces.`,
  },
  {
    phase: 'Domain', name: 'usage', deps: 'none beyond common',
    brief: `Usage metering + prepaid credits (plan §4/§5 usage-based, Phase 4).
Implement recordUsage(meter, metric, qty) -> new UsageMeter (immutable aggregate within period).
aggregateForPeriod, resetForNewPeriod.
computeUsageCharge(meter, unitAmount) -> Money.
Credit balances: grantCredits(balance, n), consumeCredits(balance, n) -> new CreditBalance (throws insufficient_credits).
checkLimit(meter, limit).
A MeterStore interface + REAL in-memory impl, and a UsageService.
Files: src/meter.ts, src/credits.ts, src/charges.ts, src/store.ts, src/service.ts, src/index.ts.
Tests: record accumulates; charge math; credit consume + insufficient; limit checks; period reset.`,
  },
  {
    phase: 'Domain', name: 'license-keys', deps: 'none (node:crypto)',
    brief: `License key issuance + verification (plan §7). REAL crypto.
Generate keys: createLicenseKey({ customerId, productId, machineLimit, domainLimit?, expiresAt? }) -> LicenseKey with key string = grouped base32/hex from crypto.randomBytes (format e.g. SK-XXXX-XXXX-XXXX-XXXX).
Offline validation token: sign a compact payload (productId, customerId, expiresAt) with HMAC-SHA256 (signLicenseToken/verifyLicenseToken) so apps can validate offline.
verify({ licenseKey, productId, machineId }) against a LicenseStore: checks status active, not expired, machine within machineLimit (activate machine if new + capacity), returns { active, reason? }.
activateMachine/deactivateMachine (immutable), activateDomain, revoke, rotate (new key, same entitlement).
LicenseStore interface + REAL in-memory impl + LicenseService.
Files: src/generate.ts, src/token.ts, src/verify.ts, src/activation.ts, src/store.ts, src/service.ts, src/index.ts.
Tests: generate format; sign/verify token; machine limit enforcement; expiry; revoke; rotate; offline token tamper fails.`,
  },
  {
    phase: 'Domain', name: 'api-keys', deps: 'none (node:crypto)',
    brief: `API key issuance + verification (plan §31 entitlement API keys). REAL crypto.
issueApiKey({ customerId, productId, scopes, env:"live"|"test" }) -> { apiKey: ApiKey(record with keyHash + keyPrefix), plaintext } where plaintext = "sk_<env>_<base64url(randomBytes(24))>" shown ONCE. Store sha256 hash only.
verifyApiKey(plaintext, store) -> { valid, apiKey? } by hashing + lookup, checks status active.
hasScope(apiKey, scope). recordUsage(apiKey) updates lastUsedAt (immutable). revoke(apiKey).
ApiKeyStore interface (findByHash, save) + REAL in-memory impl + ApiKeyService.
Files: src/issue.ts, src/verify.ts, src/scopes.ts, src/store.ts, src/service.ts, src/index.ts.
Tests: issue returns plaintext once + stores only hash; verify by plaintext; wrong key invalid; scope checks; revoke blocks.`,
  },
  {
    phase: 'Domain', name: 'file-delivery', deps: 'none (node:crypto)',
    brief: `Secure digital download delivery (plan §6). REAL signed links.
generateSignedDownloadUrl({ fileId, baseUrl, secret, expiresInSec, maxDownloads }) -> URL with query: fileId, exp, dl(token), sig (HMAC-SHA256 over canonical string).
verifySignedUrl(url, secret, now) -> { valid, fileId?, reason? } (checks sig + not expired).
A DownloadGrant model tracking downloadsRemaining; consumeDownload(grant) -> new grant (throws when exhausted); revokeOnRefund.
Optional S3/R2 presign: presignS3Get({ bucket, key, region, accessKeyId, secretAccessKey, expiresIn }) implementing AWS SigV4 query presigning with node:crypto (real algorithm).
GrantStore interface + in-memory impl + FileDeliveryService.
Files: src/signed-url.ts, src/s3-presign.ts, src/grants.ts, src/store.ts, src/service.ts, src/index.ts.
Tests: sign/verify url round trip; expired fails; tampered sig fails; download count decrements + exhaustion; sigv4 presign produces deterministic signature for fixed inputs.`,
  },
  {
    phase: 'Domain', name: 'github', deps: '@octokit/rest, @octokit/auth-app',
    brief: `GitHub repo/team access automation (plan §3, §18) — the killer wedge. REAL Octokit calls.
createGitHubAppClient({ appId, privateKey, installationId }) using @octokit/rest with createAppAuth from @octokit/auth-app.
listInstallationRepositories(); listOrgTeams(org).
verifyGithubUsername(username) GET /users/:username -> exists + user id.
grantRepoAccess({ owner, repo, username, permission }) -> POST /repos/{owner}/{repo}/collaborators/{username} (returns invitation) -> GitHubRepoAccessGrant.
addToTeam({ org, teamSlug, username, role }) -> PUT /orgs/{org}/teams/{team_slug}/memberships/{username}.
revokeRepoAccess({ owner, repo, username }) DELETE collaborator; removeFromTeam DELETE membership; cancelInvitation.
syncAccess(grants) -> reconcile expected vs actual collaborators, revoking expired, re-inviting failed -> GitHubAccessSyncRun result.
Handle failed invites + already-collaborator gracefully (map Octokit errors to SettleKitError integration_error).
Define a GitHubApi interface (the octokit surface you use) with a REAL Octokit-backed default impl so tests drive the granter/revoker/sync logic with an in-memory GitHubApi.
Files: src/github-app-client.ts, src/github-installations.ts, src/github-repositories.ts, src/github-teams.ts, src/github-access-granter.ts, src/github-access-revoker.ts, src/github-access-sync.ts, src/github-username-verification.ts, src/github-errors.ts, src/types.ts, src/index.ts.
Tests (plan §18): github-access-granter.test.ts, github-access-revoker.test.ts, github-access-sync.test.ts using in-memory GitHubApi.`,
  },
  {
    phase: 'Domain', name: 'discord', deps: 'discord-api-types',
    brief: `Discord paid-role access (plan §9, §19). REAL Discord REST v10 calls via fetch (Authorization: Bot <token>) typed with discord-api-types.
createDiscordClient({ botToken }) with base https://discord.com/api/v10.
listGuilds() (GET /users/@me/guilds); listGuildRoles(guildId) (GET /guilds/{id}/roles).
addRole({ guildId, userId, roleId }) PUT /guilds/{guild}/members/{user}/roles/{role}; removeRole DELETE same -> DiscordRoleGrant.
revokeOnExpiry(grant). resolveUserId via OAuth token (exchange) optional helper.
Map Discord error responses (rate limit 429 retry-after, missing perms) to SettleKitError.
Define DiscordApi interface + REAL fetch-backed default; tests use in-memory DiscordApi.
Files: src/discord-client.ts, src/discord-guilds.ts, src/discord-roles.ts, src/discord-role-granter.ts, src/discord-role-revoker.ts, src/discord-access-sync.ts, src/discord-errors.ts, src/types.ts, src/index.ts.
Tests (plan §19): discord-role-granter.test.ts, discord-role-revoker.test.ts.`,
  },
  {
    phase: 'Domain', name: 'saas', deps: 'none beyond common',
    brief: `SaaS plan billing + entitlements (plan §4, §20). Pure logic.
Define SaasPlan { id, name, interval, price, features: Record<string, boolean|number>, seats }.
createPlan, listPlans.
Feature flags: featureEnabled(entitlement|plan, key); featureLimit(key).
Seats: SeatManager addSeat/removeSeat with seatLimit enforcement (immutable), listSeats.
tenantEntitlement: build a saas_feature Entitlement from a plan purchase.
upgradeDowngrade(currentSub, newPlan) computing proration via common Money.
gracePeriod logic (renewal due -> in_grace until graceEndsAt -> expired).
usageLimits gate via entitlement numeric features.
customerPortal data builder: portalSummary(customer, subs, entitlements).
PlanStore + SeatStore interfaces + REAL in-memory impls + SaasService.
Files: src/saas-plan.ts, src/feature-flags.ts, src/seat-limits.ts, src/tenant-entitlements.ts, src/org-billing.ts, src/usage-limits.ts, src/upgrade-downgrade.ts, src/grace-periods.ts, src/customer-portal.ts, src/store.ts, src/service.ts, src/index.ts.
Tests (plan §20): feature-flags.test.ts, seat-limits.test.ts, tenant-entitlements.test.ts (+ proration + grace).`,
  },
  {
    phase: 'Domain', name: 'bundles', deps: 'none beyond common',
    brief: `Bundle products (plan §13, §22). One payment -> many entitlements/actions.
createBundle({ name, productIds, price, interval }) -> Bundle.
bundlePrice (sum or fixed override).
buildBundleDeliveryPlan(bundle, productsWithDeliveryActions) -> a single DeliveryPlan whose actions are the concatenation of each member product's DeliveryActions (de-duplicated, ordered).
buildBundleEntitlements(bundle, payment, members) -> Entitlement[] (one per member).
validateBundle (no empty, no cycles, all products exist via injected lookup).
BundleStore interface + in-memory impl + BundleService.
Files: src/bundle.ts, src/bundle-items.ts, src/bundle-pricing.ts, src/bundle-delivery-plan.ts, src/bundle-entitlements.ts, src/store.ts, src/service.ts, src/index.ts.
Tests (plan §22): bundle-delivery-plan.test.ts (actions merged correctly) + pricing + entitlement generation.`,
  },
  {
    phase: 'Domain', name: 'agent-services', deps: 'none beyond common',
    brief: `Agent service marketplace listings (plan §11, §23).
createAgentService({ name, description, endpoint, price, network, inputSchema, outputSchema? }) -> AgentService.
generateAgentMetadata(service) -> the machine-readable JSON exactly like plan §11 (name, description, price, currency USDC, paymentProtocol x402, network, endpoint, inputSchema).
validateInputAgainstSchema(input, service.inputSchema) -> minimal real JSON-schema validation (type/required/properties for object/string/number/boolean/array).
agentPricing helpers (per-request Money).
recordAgentUsage(service, buyerId) -> usage event.
agentDiscovery: filter/search listings by tag/network/price.
agentReputation aggregate.
Store interfaces + in-memory + AgentServiceService.
Files: src/agent-service.ts, src/agent-readable-schema.ts, src/agent-service-metadata.ts, src/json-schema-validate.ts, src/agent-pricing.ts, src/agent-usage.ts, src/agent-discovery.ts, src/agent-reputation.ts, src/store.ts, src/service.ts, src/index.ts.
Tests (plan §23): agent-service-metadata.test.ts (matches §11 shape), agent-pricing.test.ts, plus schema validation tests.`,
  },
  {
    phase: 'Domain', name: 'escrow', deps: 'none beyond common',
    brief: `Escrow tasks for agents/freelancers (plan §12, §24). State machine.
createTask({ buyerCustomerId, title, description, amount }) -> EscrowTask status "created".
fundTask(task, fundingTxHash) -> "funded" (records EscrowFunding).
assignWorker(task, workerCustomerId) -> "assigned".
submitWork(task, submission) -> "submitted".
approve(task) -> "approved" then release(task, releaseTxHash) -> "released".
refund(task, reason) -> "refunded".
openDispute(task, reason) -> "disputed"; resolveDispute(task, outcome:"release"|"refund").
Enforce LEGAL transitions only (throw conflict on illegal transition). All transitions return NEW immutable task objects.
Store interfaces + in-memory + EscrowService.
Files: src/escrow-task.ts, src/escrow-status.ts (transition table + guard), src/escrow-funding.ts, src/escrow-release.ts, src/escrow-refund.ts, src/escrow-disputes.ts, src/task-submissions.ts, src/task-review.ts, src/store.ts, src/service.ts, src/index.ts.
Tests (plan §24): escrow-release.test.ts, escrow-refund.test.ts + illegal transition guard.`,
  },
  {
    phase: 'Domain', name: 'marketplace-core', deps: 'none beyond common',
    brief: `Marketplace discovery (plan §11 Phase 5).
createListing({ merchantId, productId?|agentServiceId?, title, summary, tags }) -> MarketplaceListing.
publish/unpublish.
search({ query?, tags?, sort:"top"|"new"|"price" }) -> ranked listings (real text match on title/summary/tags + rating sort).
addRating(listing, stars 1..5) -> new listing with recomputed ratingAverage/ratingCount (immutable).
sellerProfile(merchantId, listings) aggregate.
marketplaceFee(amount, feeBps) -> Money (plan §32 5%–15%).
ListingStore interface + in-memory impl + MarketplaceService.
Files: src/listing.ts, src/search.ts, src/ratings.ts, src/seller-profile.ts, src/fees.ts, src/store.ts, src/service.ts, src/index.ts.
Tests: search ranking, rating average recompute, fee math, publish gating.`,
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

function buildPrompt(pkg) {
  return `You are implementing the @settlekit/${pkg.name} package of the SettleKit Commerce OS monorepo (TypeScript, pnpm workspace at /Users/arhansubasi/settlekit).

Real third-party npm deps to use: ${pkg.deps}.

RESPONSIBILITIES:
${pkg.brief}

${CONVENTIONS}
${COMMON_API}

Write every file now using the Write tool with absolute paths under /Users/arhansubasi/settlekit/packages/${pkg.name}/. Implement real, correct, compiling TypeScript. Then return the manifest.`;
}

phase('Foundation');
const foundation = PACKAGES.filter((p) => p.phase === 'Foundation');
const domain = PACKAGES.filter((p) => p.phase === 'Domain');

const results = await parallel([
  ...foundation.map((p) => () =>
    agent(buildPrompt(p), { label: `pkg:${p.name}`, phase: 'Foundation', schema: MANIFEST_SCHEMA })
  ),
  ...domain.map((p) => () =>
    agent(buildPrompt(p), { label: `pkg:${p.name}`, phase: 'Domain', schema: MANIFEST_SCHEMA })
  ),
]);

const built = results.filter(Boolean);
log(`Built ${built.length}/${PACKAGES.length} packages`);
return { built };
