# settlekit-nextjs-saas-starter

A runnable **Next.js 14 (App Router, TypeScript)** SaaS starter that gates a
premium feature behind a **SettleKit entitlement** using the
[`@settlekit/react`](../../packages/react) SDK and the SettleKit API.

The fictional product — **AI Export Pro** — has a Free and a Pro tier. The
"Export with AI" action is gated behind the `ai_export` feature:

- **Entitled customer** → the real AI Export tool renders.
- **Not entitled** → the `<Paywall>` fallback renders an `<UpgradeButton>` that
  starts a real SettleKit checkout session.

```
<SettleKitProvider customerId=…>          (app/providers.tsx)
        │
        ▼
  <Paywall feature="ai_export"            (components/GatedExport.tsx)
           fallback={<UpgradePanel/>}>     ── not entitled → <UpgradeButton/>
     <ExportButton/>                        ── entitled    → AI Export tool
  </Paywall>
```

---

## What it uses from `@settlekit/react`

This example imports **only real exports** from the SDK (verified against
`packages/react/src/index.ts`):

| Export | Where | Purpose |
| --- | --- | --- |
| `SettleKitProvider` | `app/providers.tsx` | Supplies `publishableKey`, `baseUrl`, `customerId` to all hooks. |
| `Paywall` | `components/GatedExport.tsx` | Declaratively gates `ai_export` (`feature`, `loading`, `fallback`, `children`). |
| `useEntitlement` | `components/GatedExport.tsx` | Reads `{ allowed, reason, loading, error, refetch }` to show status + a "Re-check" button. |
| `UpgradeButton` | `components/UpgradePanel.tsx` | The paywall fallback; creates a checkout session and redirects. |
| `CreateCheckoutInput` (type) | `components/UpgradePanel.tsx` | Type for the checkout payload. |

Under the hood the SDK calls the SettleKit API over HTTP from the browser:

- `useEntitlement` → `POST {baseUrl}/v1/entitlements/verify` with
  `{ customerId, feature }` → `{ data: { allowed, reason? } }`.
- `UpgradeButton` → `POST {baseUrl}/v1/checkout-sessions`, then redirects to
  `{baseUrl}/checkout/{sessionId}`.

> The SDK appends `/v1` itself, so `NEXT_PUBLIC_SETTLEKIT_API_URL` must be the
> **origin only** (`http://localhost:8787`), with no `/v1` suffix.

---

## Prerequisites

### 1. Build `@settlekit/react` first

This example depends on `@settlekit/react` as `workspace:*`. Build the package
(and its `@settlekit/common` dependency) so the compiled output exists before
installing/running:

```bash
# from the repo root — builds @settlekit/react and its workspace deps
pnpm --filter @settlekit/react... build
```

(The `...` suffix tells pnpm to also build `@settlekit/common`, which
`@settlekit/react` imports at runtime.)

### 2. Run the SettleKit API

Start the API so the browser can reach it at `http://localhost:8787`. Use the
bootstrap key so the SDK's Bearer token authenticates immediately:

```bash
# from the repo root — start the API on :8787 with a known dev key
API_BOOTSTRAP_KEY=sk_dev pnpm --filter @settlekit/api dev
```

(Any valid SettleKit API key works; `sk_dev` just matches this example's
defaults. Confirm the port your API prints and adjust the env var below if it
differs.)

---

## Environment variables

Copy `.env.example` to `.env.local` and adjust if needed:

```bash
cp .env.example .env.local
```

| Var | Default | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SETTLEKIT_API_URL` | `http://localhost:8787` | API **origin** (no `/v1`). |
| `NEXT_PUBLIC_SETTLEKIT_PUBLISHABLE_KEY` | `sk_dev` | Bearer key; match `API_BOOTSTRAP_KEY`. |
| `NEXT_PUBLIC_SETTLEKIT_ORG_ID` | `org_demo` | Org used by the checkout payload. |
| `NEXT_PUBLIC_SETTLEKIT_MERCHANT_ID` | `merchant_demo` | Merchant used by the checkout payload. |
| `NEXT_PUBLIC_SETTLEKIT_PRO_PRICE_ID` | `price_pro_monthly` | Price id for the Pro line item. |
| `NEXT_PUBLIC_SETTLEKIT_PAY_TO_ADDRESS` | `0x…dEaD` | Settlement address for checkout. |

All are `NEXT_PUBLIC_*` because the SDK runs in the browser.

---

## Install & run

```bash
# from this directory: examples/nextjs-saas-starter
pnpm install
pnpm dev
```

Open <http://localhost:3010>.

> `examples/` is **not** a pnpm workspace member, so this app installs and runs
> standalone. Just make sure step 1 (build `@settlekit/react`) ran first so the
> `workspace:*` link resolves to built output.

---

## Walkthrough

1. **Open the app** at <http://localhost:3010>. You'll see the Free vs Pro tiers
   and a "Try the gated feature" section with a customer-id input.

2. **Enter a customer id** (e.g. `cus_alice`). The app immediately calls
   `POST /v1/entitlements/verify`. Since this customer has no `ai_export`
   entitlement yet, you'll see **Locked** and the **Upgrade to Pro** paywall.
   The status line shows the reason from the API (e.g. `feature_not_granted`).

3. **Grant the entitlement** for that customer via the SettleKit API or your
   dashboard. The `ai_export` feature must resolve to `true` in the customer's
   entitlement `features` map. For example, grant a Pro-style entitlement and
   then sanity-check verification directly:

   ```bash
   # Verify the feature the way the SDK does (should report allowed:false first,
   # then allowed:true once the customer has an ai_export=true entitlement):
   curl -s http://localhost:8787/v1/entitlements/verify \
     -H 'Authorization: Bearer sk_dev' \
     -H 'Content-Type: application/json' \
     -d '{"customerId":"cus_alice","feature":"ai_export"}'

   # Inspect the customer's current entitlements:
   curl -s 'http://localhost:8787/v1/entitlements?customerId=cus_alice&activeOnly=true' \
     -H 'Authorization: Bearer sk_dev'
   ```

   Create the customer first if needed:

   ```bash
   curl -s http://localhost:8787/v1/customers \
     -H 'Authorization: Bearer sk_dev' \
     -H 'Content-Type: application/json' \
     -d '{"organizationId":"org_demo","email":"alice@example.com"}'
   ```

   How entitlements are granted (subscription, manual grant, bundle, or the
   checkout completion below) depends on your SettleKit setup — any path that
   results in an active entitlement whose `features.ai_export === true` unlocks
   the feature.

4. **Refresh / Re-check.** Click **Re-check** (or reload). `useEntitlement`
   re-verifies, the `<Paywall>` now reports **Unlocked**, and the **AI Export**
   tool appears. Paste notes and click **Export with AI** to run the real
   summarisation (no external AI key required — it's deterministic local logic).

5. **Or upgrade via checkout.** Instead of granting manually, click **Upgrade to
   Pro**. `UpgradeButton` creates a checkout session
   (`POST /v1/checkout-sessions`) and redirects to the hosted checkout at
   `{API_URL}/checkout/{sessionId}`. Completing that checkout grants the
   entitlement; returning to the app shows the feature unlocked.

---

## File tour

| File | Purpose |
| --- | --- |
| `app/layout.tsx` | Root layout; nav + wraps children in `<Providers>`. |
| `app/providers.tsx` | Client `<SettleKitProvider>` wrapper + customer-id context. |
| `app/page.tsx` | Landing page (tiers + gated feature). |
| `app/export/page.tsx` | Dedicated Export page (same gate). |
| `app/settlekit.config.ts` | Env-driven SettleKit config + demo identifiers. |
| `app/globals.css` | Clean, legible styling. |
| `components/CustomerIdInput.tsx` | Customer-id input bound to the provider. |
| `components/GatedExport.tsx` | `<Paywall>` + `useEntitlement` gate. |
| `components/ExportButton.tsx` | The premium AI Export feature (real logic). |
| `components/UpgradePanel.tsx` | Paywall fallback using `<UpgradeButton>`. |

No mocks, no placeholders — every SettleKit call hits the real API.
