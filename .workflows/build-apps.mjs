export const meta = {
  name: 'settlekit-build-apps',
  description: 'Build all SettleKit apps (api, worker, dashboard, checkout, marketplace, admin, docs, examples) with real code',
  phases: [
    { title: 'Backend' },
    { title: 'Frontend' },
  ],
};

const SHARED = `
You are building an app inside the SettleKit monorepo at /Users/arhansubasi/settlekit.
The 22 @settlekit/* packages already exist and BUILD GREEN. Before importing from any package,
use Read/Grep on /Users/arhansubasi/settlekit/packages/<name>/src/index.ts to discover its EXACT
exported names and signatures. Bind to the real exports — do not invent function names.

Available workspace packages (depend via "workspace:*"):
@settlekit/common, database, payments, arc, circle, x402, webhooks, notifications, risk,
entitlements, delivery, usage, license-keys, api-keys, file-delivery, github, discord, saas,
bundles, agent-services, escrow, marketplace-core.

HARD CONSTRAINTS (user demanded): REAL files, REAL API routes, REAL pages. NO mocks/stubs/placeholders/TODO.
Every route handler and page must contain working logic that calls the real package functions / a real
data layer. Use ESM. Keep files <400 lines, many small files.

Create ONLY files under your own app directory /Users/arhansubasi/settlekit/apps/<name>/.
Pin real published versions for any npm deps you add. Always add devDeps @types/node ^20.14.0 and typescript ^5.5.4.
`;

const MANIFEST_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['app', 'files', 'summary'],
  properties: {
    app: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

const APPS = [
  {
    phase: 'Backend', name: 'api',
    prompt: `Build apps/api — the SettleKit REST API using Hono (latest 4.x) running on Node via @hono/node-server.
Implement a real route module per resource and mount under /v1. Cover the CORE commerce endpoints
(products, prices, checkout-sessions, payments, customers, subscriptions, entitlements, webhooks, files)
AND every endpoint in plan §26:
GitHub: POST/GET /v1/integrations/github/installations, GET /v1/integrations/github/repositories,
GET /v1/integrations/github/teams, POST /v1/github/access/grant|revoke|sync.
Discord: POST /v1/integrations/discord/connect, GET /v1/integrations/discord/guilds|roles, POST /v1/discord/access/grant|revoke.
SaaS: POST/GET /v1/saas/plans, POST /v1/saas/features, POST /v1/saas/entitlements/verify, POST /v1/saas/seats, POST /v1/saas/seats/remove.
Bundles: POST/GET /v1/bundles, GET/PATCH /v1/bundles/:id, POST /v1/bundles/:id/publish.
Delivery: GET /v1/delivery-runs, GET /v1/delivery-runs/:id, POST /v1/delivery-runs/:id/retry, POST /v1/delivery-actions/test.
Agent services: POST/GET /v1/agent-services, GET/PATCH /v1/agent-services/:id, POST /v1/agent-services/:id/publish, GET /v1/agent-services/:id/metadata.json.
Escrow: POST/GET /v1/escrow/tasks, POST /v1/escrow/tasks/:id/fund|submit|approve|refund.
Also entitlement verify + api-key issue + license verify endpoints.
Structure: src/server.ts (createServer + serve), src/app.ts (Hono app, mounts routers, error handler that maps SettleKitError -> {error} with httpStatus), src/routes/*.ts (one router per resource), src/context.ts (builds service singletons: import the real services from @settlekit packages and the in-memory repositories they ship so the API actually runs end-to-end without external infra; wire database createDb only when DATABASE_URL is set), src/middleware/auth.ts (Bearer api-key auth using @settlekit/api-keys), src/middleware/error.ts, src/index.ts.
Use a consistent response envelope { data } / { error } (plan patterns). Validate request bodies (zod, latest) and return 400 via SettleKitError on invalid input.
Add package.json (hono, @hono/node-server, zod + all @settlekit deps used), tsconfig.json (extends ../../tsconfig.base.json, module NodeNext, references the packages you import), and a test in test/app.test.ts using app.request() (Hono's built-in test client) to hit several routes for real (create product -> create price -> create checkout -> confirm payment -> entitlement granted).`,
  },
  {
    phase: 'Backend', name: 'worker',
    prompt: `Build apps/worker — the background worker (plan §17, Phase delivery/sync). A real Node service.
Responsibilities (real handlers, real loops):
- Delivery execution: consume pending delivery runs and execute via @settlekit/delivery DeliveryRunner, wiring CONCRETE clients:
  build adapter objects implementing delivery's client interfaces (GithubAccessClient -> @settlekit/github, DiscordRoleClient -> @settlekit/discord, LicenseIssuer -> @settlekit/license-keys, ApiKeyIssuer -> @settlekit/api-keys, FileGrantor -> @settlekit/file-delivery, SaasEntitler -> @settlekit/saas, WebhookSender -> @settlekit/webhooks, EmailSender -> @settlekit/notifications). These adapters contain REAL calls.
- Payment confirmation poller: use @settlekit/arc verifyUsdcTransfer / getConfirmations to confirm pending payments, then trigger delivery.
- Access sync job: periodically run @settlekit/github syncAccess + @settlekit/discord access sync for active grants; revoke expired entitlements (@settlekit/entitlements expireDue).
- Renewal/grace sweep: advance subscriptions, enter grace, expire (@settlekit/payments + @settlekit/saas).
- Webhook retry queue: redeliver failed webhooks (@settlekit/webhooks deliverWithRetry).
Structure: src/index.ts (boot: start scheduler), src/scheduler.ts (interval-based job runner with graceful shutdown on SIGINT/SIGTERM), src/jobs/*.ts (delivery-runner-job, payment-confirm-job, access-sync-job, renewal-sweep-job, webhook-retry-job), src/wiring/delivery-clients.ts (the concrete adapters), src/config.ts (env config with validation).
Add package.json (deps: the @settlekit packages used) + tsconfig + a test in test/wiring.test.ts that constructs the delivery clients wiring and runs a delivery plan end-to-end through DeliveryRunner with the real adapters pointed at in-memory stores.`,
  },
  {
    phase: 'Frontend', name: 'dashboard',
    prompt: `Build apps/dashboard — the merchant dashboard as a real Next.js 14 App Router app (TypeScript, React 18, app/ dir, "use client" only where needed).
Implement a lib/api.ts client that calls the SettleKit API (NEXT_PUBLIC_API_URL, default http://localhost:8787) with real fetch + typed responses, plus lib/format.ts (money/date).
Build real pages with data fetching (server components calling the api client) and real forms (client components POSTing):
- app/layout.tsx + app/globals.css + a Sidebar nav listing every section in plan §16.
- app/page.tsx dashboard overview (revenue, customers, active access, expiring subs, failed deliveries — fetch + render cards/tables).
- Products: app/products/page.tsx (list), app/products/new/page.tsx (the Product Builder UX from plan §28: choose what to sell -> how to charge -> what happens after payment), app/products/[id]/page.tsx.
- The §27 sections, each a real page with list/detail: github/ (page, install, repositories, teams, access), discord/ (page, servers, roles, access), saas/ (plans, features, seats, entitlements), bundles/ (page, new, [bundleId]), delivery/ (runs, logs), agent-services/ (page, new, [serviceId]), escrow/ (tasks, [taskId]).
- Also: payments, customers, subscriptions, license-keys, api-keys, files, webhooks, payouts, analytics, settings pages (real lists wired to the api client).
Add package.json (next ^14, react ^18, react-dom ^18, @types/react, @types/react-dom), next.config.mjs, tsconfig.json (Next's preset: jsx preserve, module esnext, moduleResolution bundler, NO composite — Next apps don't use project refs). app dir. Keep components in components/.
Real, clean Tailwind-free CSS (use a small globals.css with utility classes) OR inline styles — pages must render meaningfully. No placeholder "Coming soon" text — every page shows real structured data from the api client (with graceful empty states).`,
  },
  {
    phase: 'Frontend', name: 'checkout',
    prompt: `Build apps/checkout — the hosted USDC checkout as a real Next.js 14 App Router app.
- app/c/[sessionId]/page.tsx: server component fetches the checkout session from the API, renders order summary (line items, total USDC), the pay-to address + network, and a client PaymentForm.
- components/PaymentForm.tsx ("use client"): collects required delivery fields (e.g. GitHub username, Discord — based on session.collectedFields requirements), shows the USDC amount + payTo address with a copy button, lets the buyer submit their payment tx hash, then POSTs to the API to confirm; on success redirects to the success/access page.
- app/c/[sessionId]/success/page.tsx: shows receipt + delivered access (entitlements: github invite link, license key, download links, discord, api key) fetched from the API.
- app/c/[sessionId]/expired/page.tsx.
- lib/api.ts real fetch client to the SettleKit API; lib/format.ts.
Add package.json (next ^14, react ^18 + types), next.config.mjs, tsconfig.json (Next preset, bundler resolution, no composite), app dir, globals.css. Real working forms + fetch, no placeholders.`,
  },
  {
    phase: 'Frontend', name: 'marketplace',
    prompt: `Build apps/marketplace — public marketplace + agent discovery as a real Next.js 14 App Router app.
- app/page.tsx: lists published MarketplaceListings (fetch from API /v1 marketplace/agent-services), with search + tag filters (real query params).
- app/listings/[id]/page.tsx: listing detail with rating, price, buy button linking to a checkout session.
- app/agents/page.tsx: agent service directory.
- app/agents/[id]/page.tsx: human-readable agent service page.
- app/agents/[id]/metadata.json/route.ts: a real Route Handler returning the agent-readable JSON metadata (plan §11) with content-type application/json — fetched/generated from the API.
- app/sellers/[slug]/page.tsx: public seller profile.
- lib/api.ts real fetch client + lib/format.ts.
Add package.json (next ^14, react ^18 + types), next.config.mjs, tsconfig.json (Next preset), app dir, globals.css. Real data + working search, no placeholders.`,
  },
  {
    phase: 'Frontend', name: 'admin',
    prompt: `Build apps/admin — internal admin + risk console as a real Next.js 14 App Router app (plan §16 Admin/risk, §33 Phase 6).
- app/page.tsx: platform overview (orgs, GMV, active entitlements, failed deliveries) from the API.
- app/risk/page.tsx: risk queue listing RiskProfiles with score/flags and allow/review/block actions (uses @settlekit/risk decisions via API).
- app/organizations/page.tsx + [id]/page.tsx.
- app/deliveries/page.tsx: failed delivery runs with retry action (POST /v1/delivery-runs/:id/retry).
- app/webhooks/page.tsx: webhook delivery log + replay.
- lib/api.ts + lib/format.ts.
Add package.json (next ^14, react ^18 + types), next.config.mjs, tsconfig.json (Next preset), globals.css. Real tables + actions, no placeholders.`,
  },
  {
    phase: 'Frontend', name: 'docs',
    prompt: `Build apps/docs — developer documentation site as a real Next.js 14 App Router app rendering MDX-free real content pages (plain TSX content is fine).
Pages (real written content + real code samples that match the actual SDK/middleware exports — Read the packages to get the real signatures):
- app/page.tsx: overview (the plan §34 landing message + what SettleKit does).
- app/quickstart/page.tsx: connect, create product, set price, share checkout link.
- app/guides/github-repo-sales/page.tsx (plan §3 flows).
- app/guides/saas-billing/page.tsx (entitlements SDK example from §4).
- app/guides/paid-apis-x402/page.tsx (withSettleKitPayment example from §5, matching real @settlekit/x402 export).
- app/guides/license-keys/page.tsx, app/guides/bundles/page.tsx, app/guides/agent-services/page.tsx.
- app/api-reference/page.tsx: list the real /v1 endpoints from apps/api.
- components/CodeBlock.tsx, components/Nav.tsx; lib/nav.ts.
Add package.json (next ^14, react ^18 + types), next.config.mjs, tsconfig.json (Next preset), globals.css. Real prose + real, accurate code samples.`,
  },
  {
    phase: 'Frontend', name: 'examples',
    prompt: `Build apps/examples — runnable TypeScript examples that exercise the REAL @settlekit packages end-to-end (plan §17 examples app).
Read the real exports of the packages first, then write working scripts:
- src/saas-entitlement-check.ts: create a plan, grant entitlement from a payment, verify a feature + deduct credits (uses @settlekit/saas + @settlekit/entitlements).
- src/x402-paid-api.ts: build a paid API handler with @settlekit/x402 withSettleKitPayment and demonstrate the 402 -> pay -> 200 flow against real Request/Response.
- src/license-verify.ts: issue a license with @settlekit/license-keys, then verify it with machine activation.
- src/github-repo-sale.ts: build a delivery plan with a github_invite action and run it through @settlekit/delivery DeliveryRunner with an in-memory GitHubAccessClient adapter (shows the real wiring).
- src/bundle-checkout.ts: build a bundle, generate its delivery plan + entitlements.
- src/run-all.ts: imports and runs each example, printing results.
Add package.json (deps: the @settlekit packages used; a "start": "node --import tsx src/run-all.ts" script with tsx ^4 as devDep), tsconfig.json (extends base, module NodeNext), and a test/examples.test.ts (vitest) that imports each example's exported main() and asserts it completes successfully. Each example file should export an async main() AND run it when executed directly.`,
  },
];

phase('Backend');
const backend = APPS.filter((a) => a.phase === 'Backend');
const frontend = APPS.filter((a) => a.phase === 'Frontend');

const results = await parallel([
  ...backend.map((a) => () =>
    agent(`${a.prompt}\n\n${SHARED}\n\nWrite all files now, then return the manifest.`, {
      label: `app:${a.name}`, phase: 'Backend', schema: MANIFEST_SCHEMA,
    })
  ),
  ...frontend.map((a) => () =>
    agent(`${a.prompt}\n\n${SHARED}\n\nWrite all files now, then return the manifest.`, {
      label: `app:${a.name}`, phase: 'Frontend', schema: MANIFEST_SCHEMA,
    })
  ),
]);

const built = results.filter(Boolean);
log(`Built ${built.length}/${APPS.length} apps`);
return { built };
