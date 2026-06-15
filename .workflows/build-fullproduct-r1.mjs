export const meta = {
  name: 'settlekit-fullproduct-r1',
  description: 'Full-product round 1: auth package, ui design-system, persistence-gap adapters (no tests)',
  phases: [{ title: 'Round1' }],
};

const RULES = `
SettleKit monorepo at /Users/arhansubasi/settlekit (pnpm workspace, TypeScript ESM).
HARD RULES: REAL code only — no mocks/stubs/placeholders/TODO. DO NOT write tests, *.test.ts, vitest config, or a "test" script.
Backend package conventions: NodeNext + verbatimModuleSyntax + strict + noUncheckedIndexedAccess.
- package.json: name @settlekit/<n>, type module, main ./dist/index.js, types ./dist/index.d.ts, exports map, files ["dist"],
  scripts { build: "tsc -b" }, deps { "@settlekit/common": "workspace:*", ...real npm deps }, devDeps { @types/node ^20.14.0, typescript ^5.5.4 }.
- tsconfig.json extends ../../tsconfig.base.json: compilerOptions { rootDir src, outDir dist, composite true }, references [{ path: "../common" }] (+ others), include ["src/**/*"], exclude ["dist","node_modules","**/*.test.ts"].
- Relative imports end in .js; type-only imports use 'import type'; @settlekit/* needs no .js suffix. src/index.ts re-exports public API. Files <400 lines.
Create ONLY files under your assigned directory (the persistence task is the sole exception and is scoped below).
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: { unit: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
};

const TASKS = [
  {
    label: 'pkg:auth',
    prompt: `Build @settlekit/auth at /Users/arhansubasi/settlekit/packages/auth — a real, storage-agnostic authentication package for SettleKit (merchants + customers). REAL crypto via node:crypto only; no external auth SDK. It must NOT edit apps/api (wiring happens in a later round) — package only.
First READ packages/common/src/{ids,result,time}.ts and packages/api-keys/src/{issue,verify,store}.ts to reuse SettleKitError/Result/generateId/generateSecret and mirror the api-keys hashing style.
Implement (split into small files):
- src/types.ts: Account { id, type: "merchant"|"customer", email, organizationId?, displayName?, createdAt }, Session { id, accountId, token (opaque), expiresAt, createdAt }, MagicLink { id, email, token, expiresAt, consumedAt? }, PasswordCredential { accountId, hash, salt }.
- src/password.ts: hashPassword(password) using crypto.scryptSync with a random salt -> { hash, salt }; verifyPassword(password, hash, salt) with crypto.timingSafeEqual.
- src/sessions.ts: createSession(accountId, ttlSec) -> Session (token = generateSecret(32), store the SHA-256 hash, return plaintext once); verifySessionToken(plaintext, store) -> { account, session } | null; revokeSession; isExpired (uses common isPast).
- src/magic-link.ts: issueMagicLink(email, ttlSec) -> { magicLink, token } (hash stored); consumeMagicLink(token, store) -> Account-or-create result; single-use (sets consumedAt).
- src/signed-cookie.ts: signCookie(value, secret) / verifyCookie(signed, secret) HMAC-SHA256 for stateless session cookies (timingSafeEqual).
- src/store.ts: AuthStore interface (accounts findById/findByEmail/save; sessions saveSession/findSessionByHash/deleteSession; magic-link save/findByHash/consume; password get/set) + a REAL InMemoryAuthStore.
- src/service.ts: AuthService over AuthStore — registerWithPassword, loginWithPassword (-> session), requestMagicLink, completeMagicLink (-> session), authenticateSession(token), logout. Returns Result<_, SettleKitError> (codes unauthorized/validation_error/conflict).
- src/index.ts: re-export everything.
Depend on @settlekit/common only. Ensure 'tsc -b' is green.`,
  },
  {
    label: 'pkg:ui',
    prompt: `Build @settlekit/ui at /Users/arhansubasi/settlekit/packages/ui — a shared React 18 design-system used by SettleKit's Next.js apps (dashboard/portal/admin/web/checkout/marketplace/docs). Standalone package; do NOT edit any app (adoption happens later).
First READ apps/dashboard/app/globals.css and apps/web/app/globals.css to extract the common visual language (dark theme, accent gradient, cards, tables, badges, nav) and unify it.
Implement:
- src/theme.css: CSS custom properties (color tokens, spacing, radius, shadows, font stacks) + base utility classes (.sk-card, .sk-btn, .sk-table, .sk-badge, .sk-input, .sk-grid, .sk-stat) — a single importable stylesheet apps can include.
- src/components/*.tsx (React, "use client" only where stateful): Button, Card, Table (generic columns+rows), Badge/StatusBadge, StatCard, Input, Select, FormRow, Nav/NavLink, EmptyState, CopyButton, PageHeader, Money (formats a USDC decimal string, never float), Spinner.
- src/format.ts: formatUsdc(amount: string), formatDate, relativeTime, humanize, blockExplorerUrl(network, txHash).
- src/index.ts re-exports components + format; src/styles.ts exports the theme.css path note.
package.json: peerDependencies react ^18 / react-dom ^18; devDeps @types/react ^18.3.3, @types/react-dom ^18.3.0, @types/node, typescript; dependency @settlekit/common workspace:* (for Money/Currency types only).
tsconfig.json: extends ../../tsconfig.base.json with jsx "react-jsx", lib ["ES2022","DOM","DOM.Iterable"], composite true, references [{ path: "../common" }], include src. Type-level build only (use createElement; nothing renders at build). Ensure 'tsc -b' is green. No tests.`,
  },
  {
    label: 'task:persistence',
    prompt: `Close the 4 Postgres persistence gaps (plan Phase D). Scoped file ownership: you may edit ONLY (a) /Users/arhansubasi/settlekit/packages/database/src/schema/*.ts, (b) create files under /Users/arhansubasi/settlekit/apps/api/src/db/pg/, and (c) edit /Users/arhansubasi/settlekit/apps/api/src/context.ts. Do NOT run drizzle-kit, do NOT run builds, do NOT edit anything else (the parent regenerates the migration + verifies live).
First READ: the existing reference adapters apps/api/src/db/pg/products-store.ts, checkout-repository.ts, escrow-store.ts; apps/api/src/db/codec.ts; apps/api/src/db/seed.ts; and the package store interfaces in packages/{saas,usage,file-delivery,agent-services}/src/store.ts. Follow the document-projection pattern EXACTLY (import { eq, type Database, <tables> } from "@settlekit/database"; canonical entity in metadata.__doc via packDoc; reads via unpackDoc/unpackDocs; project NOT NULL columns; DEFAULT_MERCHANT_ID/DEFAULT_CUSTOMER_ID for FK columns the domain lacks).

(1) SCHEMA (packages/database/src/schema):
- saas.ts: on saasSeats, remove the .notNull() AND .references(...) from subscription_id (make it plain nullable text) so a SeatRecord aggregate can be stored without a subscription row. Keep other columns.
- agents.ts: on agentUsageEvents, remove .notNull() AND .references(...) from agent_buyer_id (plain nullable text).
- file-delivery: add a NEW table to a NEW file schema/file_delivery.ts: download_grants { id (idColumn), merchant_id (text notNull default not needed — use plain text, NO fk), file_id (text notNull), customer_id (text), download_token (text notNull), status (text notNull default 'active'), downloads_remaining (integer), expires_at (nullableTimestamp), metadata (metadataColumn), ...timestamps }. Index on file_id + download_token.
- marketplace.ts (or a new file): add table agent_reputations { id (idColumn = serviceId), service_id (text notNull), rating_count (integer notNull default 0), rating_sum (integer notNull default 0), rating_average (text), metadata, ...timestamps }.
- Register all new tables in schema/index.ts (export + the schema object). Update packages/database/test/schema.test.ts table-name list + imports to include download_grants and agent_reputations (the test asserts the exact set).

(2) Pg ADAPTERS (apps/api/src/db/pg/):
- seat-store.ts: PgSeatStore implements SeatStore (@settlekit/saas) — get(customerId)/save(record). Store the SeatRecord doc in saas_seats keyed by id = "seat_" + customerId (project customer_id, subscription_id = null, status, metadata=packDoc). get filters by id.
- agent-usage-store.ts: PgAgentUsageStore implements AgentUsageStore (@settlekit/agent-services) — append(event)/listByService(serviceId). id = event.id; project agent_service_id=event.serviceId, agent_buyer_id=null, amount=event.amount.amount, currency, occurred_at=new Date(event.createdAt), metadata=packDoc. listByService filters by agent_service_id.
- file-grant-store.ts: PgGrantStore implements GrantStore (@settlekit/file-delivery) — create/get/getByDownloadToken/update/listByFile/listByCustomer over download_grants. READ the DownloadGrant type for fields; project file_id, customer_id, download_token, status, downloads_remaining, expires_at, merchant_id = DEFAULT_MERCHANT_ID; doc in metadata.
- agent-reputation-store.ts: PgAgentReputationStore implements AgentReputationStore (@settlekit/agent-services) — get(serviceId)/recordRating(serviceId, stars). Read-modify-write the agent_reputations row (id=serviceId), recompute average; doc in metadata.

(3) WIRE INTO apps/api/src/context.ts:
- Import the 4 new adapters. Replace the in-memory-only usages: saas seats (new SaasService({ plans, seats: pick(db, d=>new PgSeatStore(d), ()=>new InMemorySeatStore()) })), agent usage + reputation in the AgentServiceService stores, and the file-delivery GrantStore (FileDeliveryService currently uses InMemoryGrantStore — make it pick(db, PgGrantStore, InMemoryGrantStore)). Use the existing pick<T>(...) helper with EXPLICIT type args (e.g. pick<SeatStore>(...)) to avoid inference errors. Import the needed store interface types from their packages.
Ensure your edits are internally consistent (correct constructor signatures — READ the FileDeliveryService/AgentServiceService/SaasService constructors first). No tests, no builds.`,
  },
];

phase('Round1');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${RULES}\n\nWrite all files now, then return the manifest.`, {
    label: t.label, phase: 'Round1', schema: MANIFEST,
  }))
);
log(`Round1: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
