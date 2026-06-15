export const meta = {
  name: 'settlekit-build-distribution',
  description: 'Build the SettleKit distribution layer: SDK, React lib, deploy infra + CI (no tests)',
  phases: [{ title: 'Distribution' }],
};

const NO_TESTS = `
HARD RULES:
- REAL code only. No mocks/stubs/placeholders/TODO/"not implemented".
- DO NOT write any tests, test files, vitest config, *.test.ts, or a "test" npm script. The user explicitly does not want tests.
- TypeScript ESM. The repo root tsconfig.base.json uses NodeNext + verbatimModuleSyntax + strict + noUncheckedIndexedAccess.
  Relative imports end in .js; type-only imports use 'import type'; @settlekit/* imports need no .js suffix.
- After writing, the package MUST build with 'tsc -b' (or the app must typecheck). Create only files under your assigned directory.
- Pin real published npm versions.
`;

const COMMON_API = `
@settlekit/common exports the domain types: Product, Price, Bundle, Customer, CheckoutSession, Payment,
Subscription, Entitlement, EntitlementType, LicenseKey, ApiKey, DeliveryRun, WebhookEndpoint, AgentService,
EscrowTask, MarketplaceListing, Money, money(), plus Result/ok/err/isOk/isErr, SettleKitError, generateId.
The HTTP API (apps/api) exposes /v1 resources: products, prices, checkout-sessions, payments, customers,
subscriptions, entitlements, license-keys, api-keys, bundles, files, webhooks, delivery-runs, agent-services,
escrow, and integrations/github + integrations/discord + saas. Responses use a { data } / { error } envelope.
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: {
    unit: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

const TASKS = [
  {
    label: 'pkg:sdk',
    prompt: `Build the real @settlekit/sdk package at /Users/arhansubasi/settlekit/packages/sdk (overwrite the current 19-line placeholder src/index.ts).
This is the official TypeScript server-side SDK: a typed fetch HTTP client over the SettleKit REST API (apps/api).
First Read /Users/arhansubasi/settlekit/apps/api/src/app.ts and the route files under apps/api/src/routes/ to learn the EXACT paths, request bodies, and the response envelope, then bind the SDK to them.

Implement:
- src/http-client.ts: a real HttpClient class — constructor({ apiKey, baseUrl = "https://api.settlekit.dev", fetch?: typeof fetch, timeoutMs? }). Methods get/post/patch/delete that set Authorization: Bearer <apiKey>, Content-Type json, parse the { data }/{ error } envelope, throw a SettleKitApiError (carrying status, code, message, details) on non-2xx, and support an AbortController timeout + idempotency key header on writes.
- src/errors.ts: SettleKitApiError.
- src/resources/*.ts: one resource client class per API resource — products, prices, checkout (sessions), payments, customers, subscriptions, entitlements, licenseKeys, apiKeys, bundles, files, webhooks, deliveryRuns, agentServices, escrow, github, discord, saas. Each exposes the real CRUD/action methods that map to the API routes (e.g. entitlements.verify({ customerId, feature }), licenseKeys.verify({ licenseKey, productId, machineId }), checkout.create(...), checkout.retrieve(id), github.grant(...), saas.verifyEntitlement(...), escrow.fund(id, ...)). Use the @settlekit/common types for inputs/outputs.
- src/client.ts: SettleKit class composing all resource clients off one HttpClient; export createSettleKitClient(options) returning a SettleKit instance.
- src/index.ts: re-export SettleKit, createSettleKitClient, SettleKitApiError, and the public option/types.
Keep the SDK dependency-light: depend on @settlekit/common only (workspace:*) for types — NOT on the server packages. Remove the old @settlekit/entitlements dependency. Each file <400 lines. Ensure 'tsc -b' is green.`,
  },
  {
    label: 'pkg:react',
    prompt: `Build the real @settlekit/react package at /Users/arhansubasi/settlekit/packages/react (overwrite the current 13-line placeholder).
This is the official React component + hooks library for SaaS feature gating and checkout (plan §4: <Paywall feature="ai_export" fallback={<UpgradeButton/>}> and entitlement checks).

Implement real React 18 code ("use client" where stateful):
- src/provider.tsx: SettleKitProvider (React context holding { apiKey/publishableKey, baseUrl, customerId }) + useSettleKit() hook that reads the context (throws if missing).
- src/use-entitlement.ts: useEntitlement(feature) hook — fetches GET entitlement/verify from the API via fetch, returns { allowed, loading, error, refetch }. Uses useEffect + useState + AbortController cleanup.
- src/use-checkout.ts: useCheckout() — returns { createCheckout(input), redirectToCheckout(sessionId), loading, error }.
- src/use-credits.ts: useCredits(productId) returning { creditsRemaining, loading, error, refetch }.
- src/paywall.tsx: <Paywall feature fallback children loading?> client component that gates children behind useEntitlement, rendering fallback when not allowed and an optional loading node while resolving.
- src/upgrade-button.tsx: a real <UpgradeButton> that calls useCheckout to start an upgrade.
- src/index.ts: re-export all.
Config: package.json with peerDependencies react ^18 and react-dom ^18, devDependencies @types/react ^18.3.3, @types/react-dom ^18.3.0, @types/node, typescript, plus dependency @settlekit/common workspace:*. tsconfig.json extending ../../tsconfig.base.json but with "jsx": "react-jsx", "lib": ["ES2022","DOM","DOM.Iterable"], composite true, references ../common, include src. Ensure 'tsc -b' is green (do NOT render anything at build — type-level only). No tests.`,
  },
  {
    label: 'infra',
    prompt: `Create the deployment + developer infrastructure for the SettleKit monorepo at /Users/arhansubasi/settlekit. Real, working files only. No tests.
First Read the root package.json, apps/api/package.json, apps/worker/package.json, and one Next app's package.json to get real script names and ports.

Create:
- /Users/arhansubasi/settlekit/README.md: a comprehensive root README — what SettleKit is (use the plan §34 messaging), the monorepo layout (apps/* + packages/*), prerequisites (Node 20+, pnpm), install/build/dev commands, per-app run instructions + ports (api 8787, dashboard 3001, marketplace 3002, checkout, admin, docs), env var reference, and an architecture overview (entitlements engine + delivery runner are the core).
- /Users/arhansubasi/settlekit/ARCHITECTURE.md: the §14 universal-entitlements model, the §21 delivery action flow (payment.confirmed -> grant github + license + discord + saas entitlement + webhook + email), package dependency layering, and the data model from §15/§25.
- /Users/arhansubasi/settlekit/.env.example: every env var the system reads — DATABASE_URL, ARC_RPC_URL, ARC_USDC_ADDRESS, ARC_CHAIN_ID, CIRCLE_API_KEY, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET, DISCORD_BOT_TOKEN, RESEND_API_KEY, EMAIL_FROM, S3/R2 creds, WEBHOOK_SIGNING_SECRET, NEXT_PUBLIC_API_URL, PORT — each with a short comment and a safe placeholder.
- /Users/arhansubasi/settlekit/.dockerignore.
- /Users/arhansubasi/settlekit/docker-compose.yml: services for postgres (with volume + healthcheck), api, and worker, plus the Next apps (dashboard, checkout, marketplace, admin, docs), wired with env_file: .env and depends_on postgres; expose the right ports.
- Dockerfiles: /Users/arhansubasi/settlekit/apps/api/Dockerfile and apps/worker/Dockerfile (multi-stage: pnpm install --frozen-lockfile, build the package deps + the app via tsc, run node dist). A shared /Users/arhansubasi/settlekit/Dockerfile.next ARG-parameterised base for the Next apps (next build + next start -p $PORT). Use node:20-alpine, corepack enable for pnpm.
- /Users/arhansubasi/settlekit/Makefile: install, build, dev-api, dev-worker, dev-dashboard, db-up, db-migrate, up (docker compose up), down targets.
- /Users/arhansubasi/settlekit/.github/workflows/ci.yml: a real GitHub Actions workflow (pnpm/action-setup + setup-node@v4 cache pnpm, pnpm install --frozen-lockfile, pnpm -r build, typecheck) running on push/PR. Add a postgres service container.
- /Users/arhansubasi/settlekit/CONTRIBUTING.md: how to add a package/app, the conventions (ESM .js imports, immutability, the @settlekit/common contract).
Make the compose + Dockerfiles internally consistent with the real ports and scripts. No tests, no vitest references.`,
  },
];

phase('Distribution');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${NO_TESTS}\n${COMMON_API}\n\nWrite all files now, then return the manifest.`, {
    label: t.label, phase: 'Distribution', schema: MANIFEST,
  }))
);
const built = results.filter(Boolean);
log(`Distribution: built ${built.length}/${TASKS.length} units`);
return { built };
