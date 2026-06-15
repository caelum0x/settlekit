export const meta = {
  name: 'settlekit-fullproduct-r2',
  description: 'Full-product round 2: auth API + login UIs + commerce-engine packages (no tests)',
  phases: [{ title: 'Round2' }],
};

const RULES = `
SettleKit monorepo at /Users/arhansubasi/settlekit. REAL code only — no mocks/stubs/placeholders/TODO. DO NOT write tests/*.test.ts/vitest/"test" scripts.
Next.js apps mirror apps/dashboard config (next ^14.2.5, react ^18.3.1, Next-preset tsconfig: jsx preserve, module esnext, moduleResolution bundler, noEmit, "@/*" alias; intra-app imports OMIT .js; @settlekit/* by package name). lib/api uses NEXT_PUBLIC_API_URL (default http://localhost:8787) + { data }/{ error } envelope.
Backend packages: NodeNext + verbatimModuleSyntax + strict + noUncheckedIndexedAccess; relative imports end .js; import type for types; src/index.ts re-exports; tsconfig extends ../../tsconfig.base.json (composite, references ../common + deps); 'tsc -b' must be green. Create ONLY files under your assigned dir (auth-api agent may also edit apps/api/src/{app.ts,context.ts}).

AUTH API CONTRACT (the auth-api agent implements these; the UI agents call them). Public (no api key), under /v1/auth:
- POST /v1/auth/register { email, password, type:"merchant"|"customer", organizationId?, displayName? } -> { data: { account, sessionToken } }
- POST /v1/auth/login { email, password } -> { data: { account, sessionToken } }
- POST /v1/auth/magic-link/request { email } -> { data: { ok: true, devToken?: string } }  (devToken returned only when no email transport configured)
- POST /v1/auth/magic-link/complete { token } -> { data: { account, sessionToken } }
- GET  /v1/auth/session  (Authorization: Bearer <sessionToken>) -> { data: { account } }
- POST /v1/auth/logout   (Authorization: Bearer <sessionToken>) -> { data: { ok: true } }
sessionToken is an opaque string; clients store it in a cookie named "sk_session".
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: { unit: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
};

const TASKS = [
  {
    label: 'api:auth',
    prompt: `Wire @settlekit/auth into apps/api (you are the ONLY agent editing apps/api). READ apps/api/src/{app.ts,context.ts,http/respond.ts,http/validate.ts,middleware/auth.ts} and packages/auth/src/index.ts first.
- Add @settlekit/auth to apps/api/package.json deps + tsconfig references.
- context.ts: add an AuthService (new AuthService(new InMemoryAuthStore())) singleton to AppContext (interface-typed via the package's exported types). Also expose the session-cookie signing secret from config (reuse config.webhookSigningSecret or add AUTH_COOKIE_SECRET to config/env.ts — prefer reading process.env.AUTH_COOKIE_SECRET with a dev default).
- src/routes/auth.ts: implement the AUTH API CONTRACT exactly (register/login/magic-link request+complete/session/logout) using ctx.auth, parseBody (zod) for validation, and the { data }/{ error } envelope; map AuthService Result errors to SettleKitError (unauthorized/validation_error/conflict). For magic-link/request, if no email transport is configured (ctx.email is null) include devToken in the response so the flow is testable; otherwise send via ctx.email.
- app.ts: mount auth routes as PUBLIC (NOT behind the api-key auth guard) — e.g. app.route("/v1/auth", authRoutes()) added BEFORE/outside the v1 api-key-guarded group. Do NOT change the existing api-key guard for other /v1 routes (keep the 14 existing api tests passing).
- Ensure apps/api 'tsc -b' is green. Do not touch other apps. No tests.`,
  },
  {
    label: 'ui:dashboard-auth',
    prompt: `Add merchant authentication UI to apps/dashboard (edit ONLY apps/dashboard). Build against the AUTH API CONTRACT.
- lib/auth.ts: a real client — register/login/requestMagicLink/completeMagicLink/getSession/logout calling NEXT_PUBLIC_API_URL /v1/auth/*; store the returned sessionToken in the "sk_session" cookie (httpOnly not possible from client JS, so set a normal cookie via document.cookie in a client component, or use a route handler app/api/session/route.ts to set an httpOnly cookie — prefer the route handler approach for real security).
- app/(auth)/login/page.tsx and app/(auth)/signup/page.tsx: real forms (email/password) with a "magic link" option; on success set the session cookie + redirect to /.
- app/(auth)/layout.tsx: a centered auth shell.
- components/AuthForm.tsx ("use client"): handles submit + error display.
- Optional: a lib/session.ts server helper that reads the sk_session cookie and calls GET /v1/auth/session, plus a small "Sign out" affordance in the existing Sidebar (only if you can edit Sidebar without breaking it — otherwise add a /logout route handler).
Keep it non-breaking: existing pages must still build. Do NOT add a global redirect guard that would break the current pages. apps/dashboard must pass 'tsc --noEmit'. No tests.`,
  },
  {
    label: 'ui:portal-auth',
    prompt: `Add customer authentication UI to apps/portal (edit ONLY apps/portal). Build against the AUTH API CONTRACT (use type:"customer").
- lib/auth.ts: client for register/login/requestMagicLink/completeMagicLink/getSession/logout against /v1/auth/*; persist sessionToken in the "sk_session" cookie (prefer an app/api/session/route.ts route handler that sets an httpOnly cookie).
- app/(auth)/login/page.tsx + app/(auth)/signup/page.tsx + app/(auth)/layout.tsx: real customer sign-in/up with a magic-link option. On success, set cookie and redirect to /c/[customerId] using the returned account id as the customer id.
- components/AuthForm.tsx ("use client").
The portal currently routes by /c/[customerId]; after login, derive the customerId from the authenticated account and redirect there. Keep existing pages building (no global guard). apps/portal must pass 'tsc --noEmit'. No tests.`,
  },
  {
    label: 'pkg:commerce-engines',
    prompt: `Flesh out four thin single-file commerce packages into REAL engines (package-only — do NOT edit any app; API/dashboard wiring is a later round). For EACH: READ the current packages/<name>/src/index.ts and EXTEND (keep existing exports working), split into small files, add a Store interface + InMemory store + a Service, all immutable + Result-returning where fallible, USDC math via @settlekit/common bigint helpers (never float). Add @types/node + keep deps to @settlekit/common (+ @settlekit/payments types if needed).
- packages/refunds: Refund { id, paymentId, customerId, amount (Money), reason, status (pending|succeeded|failed), createdAt }. createRefund (validates amount <= original), markSucceeded/markFailed (immutable). RefundStore + RefundService (list by payment/customer). Partial + full refunds.
- packages/dunning: a real failed-payment retry engine. DunningSchedule (default attempts at +0/+1d/+3d/+7d), DunningState { subscriptionId, attempt, nextAttemptAt, status (active|recovered|exhausted) }. startDunning, recordAttempt(outcome), recover, isExhausted. DunningStore + DunningService.
- packages/disputes: Dispute { id, paymentId, customerId, reason, status (open|under_review|won|lost|refunded), evidence[], openedAt, resolvedAt? }. openDispute, submitEvidence, resolve(outcome) — legal transitions only (throw conflict otherwise). DisputeStore + DisputeService.
- packages/payouts: merchant settlement. Payout { id, organizationId, walletAddress, amount (Money), network, status (pending|paid|failed), txHash?, createdAt, paidAt? }. createPayout, markPaid(txHash), markFailed; computeAvailableBalance(payments, priorPayouts) -> Money (gross confirmed minus already-paid). PayoutStore + PayoutService.
Each package's 'tsc -b' must be green. No tests.`,
  },
];

phase('Round2');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${RULES}\n\nWrite all files now, then return the manifest.`, {
    label: t.label, phase: 'Round2', schema: MANIFEST,
  }))
);
log(`Round2: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
