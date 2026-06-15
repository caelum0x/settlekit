# @settlekit/portal

The SettleKit **customer portal** (plan §31). Buyers manage everything they
bought: access entitlements, subscriptions, license keys, API keys, payments /
receipts, and downloads — all settled in USDC.

Built as a Next.js 14 App Router app, mirroring `apps/dashboard`. Dev port: **3007**.

## Running

```bash
pnpm --filter @settlekit/portal dev     # http://localhost:3007
pnpm --filter @settlekit/portal build
pnpm --filter @settlekit/portal start
```

The portal reads the SettleKit API at `NEXT_PUBLIC_API_URL`
(default `http://localhost:8787`). Start the API (`apps/api`) alongside it.

## How it's scoped

The portal is scoped to a single customer via the route `/c/[customerId]`.

- `/` — landing page explaining the portal plus a small form to enter a
  customer id, which routes to `/c/[customerId]`.
- `/c/[customerId]` — overview: customer info + summary cards and recent
  payments.
- `/c/[customerId]/purchases` — payments / receipts with amount (USDC), date,
  status, and tx hash linked to a block explorer.
- `/c/[customerId]/subscriptions` — plan, status, current period, renewal/grace.
- `/c/[customerId]/license-keys` — keys (with copy), status, machine limits,
  expiry.
- `/c/[customerId]/api-keys` — prefix, scopes, status, last used.
- `/c/[customerId]/access` — GitHub repo/team access and Discord roles, with a
  re-check action that reconciles pending invites.
- `/c/[customerId]/downloads` — file entitlements with on-demand signed
  download links.

## Data model

The **entitlement** is the universal access layer (plan §14): a payment grants
an entitlement, an entitlement grants access. The portal's primary read is:

- `GET /v1/customers/:id` — customer record.
- `GET /v1/entitlements?customerId=...` — every kind of access the customer has.
- `GET /v1/products` — to resolve product names.

Detail records are fetched by id from the grant source on each entitlement:

- Payments via `grantedBy.type === "payment"` → `GET /v1/payments/:id`.
- Subscriptions via `grantedBy.type === "subscription"` → `GET /v1/subscriptions/:id`.

License keys and API keys are surfaced from their `license_key` / `api_access`
entitlements (the API exposes no list endpoint for those resources — only
issue / verify / revoke). The customer-facing **verify** and GitHub **sync**
endpoints back the live re-check actions. Downloads mint a fresh HMAC-signed,
usage-limited URL via `POST /v1/files/downloads` per click.

All API reads go through `lib/api.ts`, which unwraps the `{ data }` / `{ error }`
envelope and degrades to empty arrays / nulls on failure so every page renders
a graceful empty state instead of crashing.

## Authentication note

> In production the portal would put **customer authentication** in front of
> these pages — a magic-link email or session that resolves the signed-in
> customer, so a buyer can only ever see their own data. Today the portal
> resolves a customer by id passed in the URL via the API. The id-entry form on
> the landing page is the stand-in for that sign-in step.
