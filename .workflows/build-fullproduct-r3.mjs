export const meta = {
  name: 'settlekit-fullproduct-r3',
  description: 'Full-product round 3: wire refunds/dunning/disputes/payouts into API+dashboard; worker comms jobs (no tests)',
  phases: [{ title: 'Round3' }],
};

const RULES = `
SettleKit monorepo at /Users/arhansubasi/settlekit. REAL code only — no mocks/stubs/placeholders/TODO. DO NOT write tests/*.test.ts/vitest/"test" scripts.
Conventions: apps/api is Hono (NodeNext, .js relative imports, { data }/{ error } envelope via src/http/respond.ts, parseBody via src/http/validate.ts, bearer auth middleware, unwrapResult helper for Result-returning services). Dashboard is Next 14 (bundler resolution, no .js suffix, @/* alias). Packages already built and exported.
Ensure 'tsc -b' (apps/api) and 'tsc --noEmit' (apps/dashboard) stay green.
`;

const MANIFEST = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'files', 'summary'],
  properties: { unit: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
};

const TASKS = [
  {
    label: 'api+dashboard:engines',
    prompt: `Wire the 4 commerce engines (@settlekit/refunds, @settlekit/dunning, @settlekit/disputes, @settlekit/payouts) into apps/api AND apps/dashboard. You OWN all apps/api + apps/dashboard edits this round.
FIRST READ: each package's src/index.ts + src/service.ts for exact service constructor + method signatures (several take a generate-id fn and/or now); apps/api/src/routes/coupons.ts + invoices.ts as the route/wiring REFERENCE; apps/api/src/context.ts; apps/api/src/app.ts; apps/dashboard/app/coupons/page.tsx + invoices/page.tsx + lib/nav.ts + lib/api.ts + lib/types.ts as the dashboard REFERENCE.

apps/api:
- Add @settlekit/refunds, @settlekit/dunning, @settlekit/disputes, @settlekit/payouts to package.json deps + tsconfig references.
- context.ts: add RefundService, DunningService, DisputeService, PayoutService singletons over their in-memory stores (interface-typed). If a service needs a generate-id fn, pass () => generateId(<closest ResourceName>) from @settlekit/common (or a local prefixed id).
- New routers (mirror coupons.ts pattern, parseBody + zod + { data } envelope + unwrapResult; mount under the api-key-guarded v1 group in app.ts):
  - routes/refunds.ts: POST /v1/refunds (create {paymentId,customerId,amount,reason,originalAmount?}), GET /v1/refunds?paymentId=&customerId=, POST /:id/succeed, POST /:id/fail.
  - routes/dunning.ts: POST /v1/dunning (start {subscriptionId}), GET /v1/dunning (list due/active), POST /:subscriptionId/attempt ({outcome:"recovered"|"failed"}), POST /:subscriptionId/recover.
  - routes/disputes.ts: POST /v1/disputes (open {paymentId,customerId,reason}), GET /v1/disputes?status=, GET /:id, POST /:id/evidence ({kind,description,value}), POST /:id/resolve ({outcome}).
  - routes/payouts.ts: POST /v1/payouts (create {organizationId,walletAddress,amount,network}), GET /v1/payouts?organizationId=, POST /:id/paid ({txHash}), POST /:id/fail, GET /v1/payouts/balance?organizationId= (computeAvailableBalance over the org's confirmed payments + prior payouts — use ctx.payments if reachable, else accept it returns zero when no data).
- Keep the existing api-key auth + 14 tests intact.

apps/dashboard (mirror coupons/invoices pages):
- app/refunds/page.tsx, app/dunning/page.tsx, app/disputes/page.tsx, app/payouts/page.tsx — each a real list + a create form (SimpleCreateForm/DataTable/Card/PageHeader patterns), wired to new lib/api.ts client methods.
- lib/api.ts: add api.refunds/dunning/disputes/payouts (list/create/actions). lib/types.ts: add the domain types (string-amount money). lib/nav.ts: add the 4 pages to the Commerce nav group.
Verify apps/api 'tsc -b' green and apps/dashboard 'tsc --noEmit' green. No tests.`,
  },
  {
    label: 'worker:comms',
    prompt: `Add real customer-communication jobs to apps/worker (edit ONLY apps/worker). FIRST READ apps/worker/src/{index.ts,scheduler.ts,runtime.ts,config.ts,jobs/index.ts,jobs/types.ts,jobs/renewal-sweep-job.ts,wiring/delivery-clients.ts} and packages/notifications/src/index.ts (createEmailClient, renderReceiptHtml/renderAccessGrantedEmail/renderReceiptText or whatever it really exports — READ it).
Implement real email-sending jobs using @settlekit/notifications (the worker already builds a real Resend-backed email client in index.ts; thread it through the JobContext like the other transports):
- src/jobs/receipt-email-job.ts: for newly-confirmed payments without a sent receipt, render a receipt (notifications renderReceipt*) and send via the email client; mark sent in the worker store.
- src/jobs/renewal-reminder-job.ts: for subscriptions whose currentPeriodEnd is within N days (config), send a renewal-reminder email once per period.
- src/jobs/dunning-email-job.ts: for subscriptions in grace / past_due, send a dunning email per attempt (idempotent per attempt).
- src/jobs/access-granted-email-job.ts: after a delivery run succeeds, email the buyer their delivered access (renderAccessGrantedEmail) — links/keys summarized.
Wire each into src/jobs/index.ts + register on the scheduler in src/runtime.ts with sensible intervals added to config.ts JobIntervals (e.g. receiptEmailMs, renewalReminderMs, dunningEmailMs, accessEmailMs). Use the existing store shapes; add small in-memory tracking sets/flags to src/stores.ts for "email already sent" idempotency if needed. Keep injectable transports so nothing requires live network at construction. apps/worker 'tsc -b' must be green. No tests.`,
  },
];

phase('Round3');
const results = await parallel(
  TASKS.map((t) => () => agent(`${t.prompt}\n\n${RULES}\n\nWrite all files now, then return the manifest.`, {
    label: t.label, phase: 'Round3', schema: MANIFEST,
  }))
);
log(`Round3: ${results.filter(Boolean).length}/${TASKS.length} units`);
return { built: results.filter(Boolean) };
