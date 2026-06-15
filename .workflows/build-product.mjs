export const meta = {
  name: 'settlekit-build-product',
  description: 'Product expansion: marketing site, customer portal, coupons+invoices commerce features (no tests)',
  phases: [{ title: 'Product' }],
};

const SHARED = `
You are adding product to the SettleKit monorepo at /Users/arhansubasi/settlekit (pnpm workspace, TypeScript ESM).
HARD RULES: REAL files only — no mocks/stubs/placeholders/TODO. DO NOT write any tests, *.test.ts, vitest config, or "test" npm scripts.
Create ONLY files under your assigned directory. Pin real published npm versions. Keep files <400 lines, many small files.

Next.js apps must mirror the existing apps/dashboard config exactly:
- package.json: next ^14.2.5, react ^18.3.1, react-dom ^18.3.1, @types/react ^18.3.3, @types/react-dom ^18.3.0, @types/node ^20.14.0, typescript ^5.5.4; scripts dev/build/start (next ...).
- tsconfig.json: the Next preset (jsx preserve, module esnext, moduleResolution bundler, noEmit, "@/*" path alias) — NO composite, NO project references. Intra-app relative imports OMIT the .js extension (bundler resolution); @settlekit/* imports use package names.
- next.config.mjs, next-env.d.ts, app/ dir, a single app/globals.css with utility classes (no Tailwind). Real pages with real data + graceful empty states. NO "Coming soon" placeholders.
- lib/api.ts: a real fetch client against NEXT_PUBLIC_API_URL (default http://localhost:8787) that unwraps the API { data } / { error } envelope and degrades to empty arrays/nulls on error.

Backend packages must follow the workspace package conventions (NodeNext + verbatimModuleSyntax + strict + noUncheckedIndexedAccess):
- tsconfig.json extends ../../tsconfig.base.json with rootDir src, outDir dist, composite true, references [{ "path": "../common" }] (+ any other @settlekit deps), include src.
- Relative imports end in .js; type-only imports use 'import type'; @settlekit/* needs no .js suffix. src/index.ts re-exports the public API. Ensure 'tsc -b' is green.
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: { unit: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
};

const TASKS = [
  {
    label: 'app:web',
    prompt: `Build apps/web — the public SettleKit marketing site as a real Next.js 14 App Router app (workspace name @settlekit/web, dev port 3006). Use the plan §34 messaging.
Pages (real, polished, content-rich — no lorem, no placeholders):
- app/page.tsx: hero ("Sell your software in USDC" + the §34 subhead), a primary CTA to the dashboard and a secondary to docs, a logo/trust strip, and a "what you can sell" grid (private GitHub repos, SaaS plans, paid APIs, AI agent services, digital downloads, license keys, Discord communities) from §2/§34.
- A "How it works" section: Create product -> Set price -> Buyer pays -> Access delivered.
- A "Developer tools" section (SDKs, webhooks, entitlements, x402 middleware) and a "Marketplace" teaser.
- app/pricing/page.tsx: the five tiers from plan §32 (Free, Creator $19, Pro $49, Business $199, Enterprise) with feature lists + transaction-fee rows + a marketplace-fee note.
- app/use-cases/page.tsx: the five killer use cases from §29 with target audience + promise.
- app/page sections link to /pricing, /use-cases, the docs app, and the marketplace app.
- components/ for Hero, FeatureGrid, Steps, PricingTable, Nav, Footer, CTA. app/globals.css with a clean, modern dark+accent theme (gradients, cards, responsive grid).
No API calls needed (marketing is static), but it must 'next build' cleanly. Add README.md.`,
  },
  {
    label: 'app:portal',
    prompt: `Build apps/portal — the customer-facing portal as a real Next.js 14 App Router app (workspace name @settlekit/portal, dev port 3007). Implements plan §31 "Customer portal": buyers manage everything they bought.
First READ apps/dashboard/lib/api.ts and apps/api/src/routes/*.ts to learn the real /v1 endpoints + the { data } envelope, then build a real lib/api.ts fetch client.
The portal is scoped to a single customer via a customerId in the route (e.g. /c/[customerId]). It reads that customer's data through the API:
- app/page.tsx: a landing explaining the portal + a small form to enter a customer id (or email) that routes to /c/[customerId].
- app/c/[customerId]/page.tsx: overview — customer info + summary cards (active entitlements, subscriptions, license keys, api keys, recent payments). Fetch entitlements (GET /v1/entitlements?customerId=...), subscriptions, payments, license keys, api keys via the api client.
- app/c/[customerId]/purchases/page.tsx: payments/receipts list with amount (USDC), date, status, tx hash linked to a block explorer.
- app/c/[customerId]/license-keys/page.tsx: license keys with key (copy button), status, machine limits, expiry.
- app/c/[customerId]/api-keys/page.tsx: api keys with prefix, scopes, status, last used.
- app/c/[customerId]/access/page.tsx: GitHub repo access + Discord roles granted (status, repo/role), with re-check actions.
- app/c/[customerId]/subscriptions/page.tsx: subscriptions with plan, status, current period, renewal/grace.
- app/c/[customerId]/downloads/page.tsx: file entitlements / signed download links.
- components/: CopyButton ("use client"), StatCard, DataTable, StatusBadge, PortalNav (links scoped to the current customerId), Money/date formatters in lib/format.ts.
- app/globals.css: clean portal theme. Graceful empty states everywhere (no crashes when a list is empty).
Note in the README that production would add customer authentication (magic-link/session); the portal currently resolves a customer by id via the API. Must 'next build' cleanly.`,
  },
  {
    label: 'pkg:commerce',
    prompt: `Flesh out two thin commerce packages into real engines, then wire them into the API and dashboard. READ the current packages/coupons/src/index.ts and packages/invoices/src/index.ts first and EXTEND them (keep backward-compatible exports where present).

(1) packages/coupons — a real discount engine (split into src/coupon.ts, src/redemption.ts, src/store.ts, src/service.ts, src/index.ts):
- Coupon type: code, name?, discount (percent | fixed amount | free-trial-days), currency, status (active|archived), startsAt?/expiresAt?, maxRedemptions?, redeemedCount, perCustomerLimit?, minSubtotal? (Money), appliesToProductIds? string[].
- applyCoupon(subtotal, coupon, { now?, customerId?, priorRedemptionsByCustomer? }) -> { ok, discount: Money, total: Money, reason? } enforcing active/window/expiry/max-redemptions/per-customer-limit/min-subtotal; all math in USDC base units via @settlekit/common (no float). Keep the existing applyCoupon(subtotal, coupon) shape working OR clearly supersede it.
- validateCoupon, redeemCoupon (immutable increment), normalizeCouponCode.
- CouponStore interface (findByCode/save/list) + a REAL InMemoryCouponStore + CouponService (create/get/list/validate/redeem).

(2) packages/invoices — real invoicing (src/invoice.ts, src/line-items.ts, src/render.ts, src/store.ts, src/service.ts, src/index.ts):
- Invoice: id/number, organizationId, customerId, lineItems (description, quantity, unitAmount Money), subtotal, discount?, tax? (use @settlekit/tax calculateTax), total, currency, status (draft|open|paid|void|uncollectible), issuedAt?, dueAt?, paidAt?, metadata. Fix the existing float-based total (use @settlekit/common multiplyMoney/addMoney — NO Number()).
- createInvoice, addLineItem, finalizeInvoice (draft->open), markPaid, voidInvoice (immutable transitions).
- renderInvoiceHtml(invoice, merchant) -> a real, styled HTML invoice; renderInvoiceText.
- InvoiceStore interface + InMemoryInvoiceStore + InvoiceService. invoices may depend on @settlekit/tax + @settlekit/common (add tax to tsconfig references + package.json).

(3) Wire into apps/api (you are the ONLY agent editing apps/api — safe to edit app.ts + routes):
- src/routes/coupons.ts: POST /v1/coupons (create), GET /v1/coupons, GET /v1/coupons/:code, POST /v1/coupons/:code/validate ({ subtotal, customerId? }), POST /v1/coupons/:code/redeem. Back it with a CouponService over an in-memory store on the context.
- src/routes/invoices.ts: POST /v1/invoices, GET /v1/invoices?customerId=, GET /v1/invoices/:id, GET /v1/invoices/:id.html (renders HTML, content-type text/html), POST /v1/invoices/:id/finalize, POST /v1/invoices/:id/pay, POST /v1/invoices/:id/void.
- Add coupons + invoices service singletons to apps/api/src/context.ts (in-memory stores; both interface-typed) and mount the new routers in src/app.ts under /v1. Add @settlekit/coupons + @settlekit/invoices to apps/api/package.json deps. Use the existing { data }/{ error } envelope + parseBody/validate helpers + the bearer auth middleware like the other routes.
- Add dashboard pages: apps/dashboard/app/coupons/page.tsx (list + a create form) and apps/dashboard/app/invoices/page.tsx (list + view HTML link), plus add both to the sidebar nav (apps/dashboard/lib/nav.ts) and the dashboard lib/api.ts client methods. Mirror existing dashboard page/form patterns.
Ensure the coupons + invoices packages build (tsc -b) and apps/api builds (tsc -b). No tests.`,
  },
];

phase('Product');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${SHARED}\n\nWrite all files now, then return the manifest.`, {
    label: t.label, phase: 'Product', schema: MANIFEST,
  }))
);
log(`Product: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
