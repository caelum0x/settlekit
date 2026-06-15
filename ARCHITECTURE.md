# SettleKit Architecture

This document describes the core model that powers SettleKit: the **universal
entitlements** engine, the **delivery action flow**, the **package dependency
layering**, and the **data model**.

---

## 1. Universal entitlements (the core idea)

This is the most important architecture decision in SettleKit.

**Everything becomes an entitlement.**

```text
Payment gives entitlement.
Entitlement gives access.
Access can be GitHub, SaaS, API, file, Discord, license, package, or agent tool.
```

A single `Entitlement` record represents a customer's right to access a
resource, regardless of what kind of resource it is. The `EntitlementType`
discriminates the access kind, and the same status/expiry machinery applies
uniformly.

### Examples

GitHub repo access:

```json
{
  "customerId": "cus_123",
  "productId": "prod_ai_saas_template",
  "entitlementType": "github_repo_access",
  "resourceId": "github_repo_456",
  "status": "active",
  "expiresAt": "2026-12-31T00:00:00Z"
}
```

API credits:

```json
{
  "customerId": "cus_789",
  "productId": "prod_research_api",
  "entitlementType": "api_credits",
  "creditsRemaining": 10000,
  "status": "active"
}
```

SaaS feature entitlement:

```json
{
  "customerId": "cus_555",
  "productId": "prod_saas_pro",
  "entitlementType": "saas_feature",
  "features": {
    "ai_export": true,
    "team_seats": 5,
    "max_projects": 20
  }
}
```

This one concept powers the whole product: every access check — GitHub
membership, SaaS feature gate, API metering, file download, Discord role,
agent-tool invocation — resolves to an entitlement lookup.

---

## 2. Delivery action flow

After a payment confirms, the **delivery runner** (`@settlekit/delivery`) turns a
product's configured `DeliveryAction`s into an ordered, retryable run.

```text
payment.confirmed
  → grant GitHub repo access
  → issue license key
  → assign Discord role
  → create SaaS entitlement
  → send webhook
  → email buyer
```

### Delivery actions

A product declares what should happen on purchase. Each action is a discriminated
union member:

```ts
type DeliveryAction =
  | { type: "github_invite"; repoId: string; permission?: "pull" | "push" | "maintain" }
  | { type: "github_team_add"; orgLogin: string; teamSlug: string }
  | { type: "license_key_create"; policyId: string }
  | { type: "api_key_create"; scopes: string[] }
  | { type: "file_access_grant"; fileId: string }
  | { type: "discord_role_add"; guildId: string; roleId: string }
  | { type: "saas_entitlement_create"; features: Record<string, boolean | number | string> }
  | { type: "webhook_send"; url: string }
  | { type: "email_send"; template: string };
```

This lets **one purchase trigger multiple actions**.

### Run lifecycle

```text
1. payments confirms a Payment (worker reads Arc / Circle)
2. delivery builds a DeliveryPlan from the product (or bundle) actions
3. delivery-runner executes each action in order, producing a DeliveryRun
4. each successful action grants an Entitlement (the universal record)
5. failed actions are retried with backoff; status is tracked per action
6. notifications emails the buyer their delivered access
```

The runner is **idempotent** per action and records `DeliveryLog` entries so a
retry never double-grants. The `worker` app drives confirmation, execution, and
retry sweeps.

---

## 3. Package dependency layering

Packages are layered so dependencies only point downward. `@settlekit/common` is
the foundation; the entitlements engine and delivery runner are the core; apps
sit on top.

```text
┌──────────────────────────────────────────────────────────────┐
│  Apps                                                          │
│  api · worker · dashboard · checkout · marketplace · admin ·   │
│  docs · examples                                               │
└──────────────────────────────────────────────────────────────┘
                              │ depends on
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Persistence (shared Postgres layer)                          │
│  @settlekit/persistence — every Postgres-backed store/repo,    │
│  shared by api · worker · checkout (no per-app duplication)    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Core engine                                                   │
│  delivery  ──────────────┐                                     │
│  entitlements            │  delivery orchestrates the access   │
│                          │  packages and writes entitlements   │
└──────────────────────────┼─────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Access / domain packages                                      │
│  github · discord · saas · license-keys · api-keys ·           │
│  file-delivery · webhooks · notifications · product-catalog ·  │
│  bundles · payments · agent-services · escrow · arc · circle · │
│  x402 · database                                               │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  Foundation                                                    │
│  @settlekit/common — Product, Price, Bundle, Customer,         │
│  CheckoutSession, Payment, Subscription, Entitlement,          │
│  EntitlementType, LicenseKey, ApiKey, DeliveryRun,             │
│  WebhookEndpoint, AgentService, EscrowTask, MarketplaceListing,│
│  Money, money(), Result/ok/err/isOk/isErr, SettleKitError,     │
│  generateId                                                    │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- **`@settlekit/common`** is depended on by everything and depends on nothing.
- **Access packages** (github, discord, saas, …) depend only on `common`.
- **`@settlekit/delivery`** depends on `common` plus the access packages it
  orchestrates; it is the only place that composes them.
- **`@settlekit/entitlements`** owns the universal entitlement record and access
  resolution.
- **Apps** depend on packages, never the reverse. The TypeScript project
  references in each `tsconfig.json` encode this graph.

---

## 4. Persistence & dual-backend

SettleKit runs on real PostgreSQL in production and on an in-process store with
zero external infrastructure for local dev and tests. The selection is made at
boot by the `DATABASE_URL` environment variable.

### One shared persistence layer

Every Postgres-backed store and repository lives in **`@settlekit/persistence`**
(not inside any single app). `apps/api`, `apps/worker`, and `apps/checkout` all
import the same stores, so they read and write **one shared database** — a
payment the API records is the payment the worker confirms and delivers.

### Document-projection pattern

Each table carries a `jsonb metadata` column. The full canonical domain entity
(from `@settlekit/common`) is stored under `metadata.__doc`, and a handful of
typed columns are *projected* alongside it for indexing and SQL queries. The
document is the source of truth on read, so round-trips are lossless regardless
of schema drift. The codec (`packDoc` / `unpackDoc`) lives in
`@settlekit/database`.

### Selecting a backend

```text
DATABASE_URL set    → @settlekit/persistence Postgres stores (drizzle-orm)
DATABASE_URL unset  → the in-memory stores each domain package ships
```

Both implement the same interface, so the route/job layer is
persistence-agnostic. Migrations live in `packages/database/drizzle` and are
applied with `pnpm --filter @settlekit/database db:migrate`. The default
organization + merchant are seeded idempotently on boot.

### Payment settlement is verified on-chain

When Arc settlement is configured, confirming a payment is gated on a **real
on-chain verification**: the submitted transaction must have transferred at
least the invoiced USDC to the session's `payTo` address with the required
confirmations before the payment settles and access is granted. This holds in
both `apps/api` (`/v1/payments/:id/confirm`) and the hosted checkout. With Arc
unconfigured (local dev), the recorded confirmation count is used.

---

## 5. Data model

The domain types live in `@settlekit/common`; the relational schema lives in
`@settlekit/database`. The main objects:

```text
Organization
User
Merchant
Customer
Product
Price
Bundle
CheckoutSession
Payment
Subscription
UsageMeter
CreditBalance
Entitlement
DeliveryAction
LicenseKey
ApiKey
GitHubInstallation
GitHubRepoAccess
DiscordRoleAccess
FileAsset
WebhookEndpoint
MarketplaceListing
AgentService
EscrowTask
PayoutWallet
RiskProfile
```

### Core type shapes

```ts
type Product = {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  type: ProductType;
  status: "draft" | "active" | "archived";
  deliveryMode: DeliveryMode;
};

type Price = {
  id: string;
  productId: string;
  amount: string;
  currency: "USDC";
  interval?: "one_time" | "monthly" | "yearly";
  usageBased?: boolean;
};
```

### Database tables

Beyond the core commerce tables (products, prices, customers, payments,
subscriptions, entitlements), the access-delivery and marketplace surfaces add:

```text
github_installations          discord_connections        saas_plans
github_repositories           discord_guilds             saas_features
github_teams                  discord_roles              saas_seats
github_repo_access_grants     discord_role_grants        saas_entitlement_rules
github_access_sync_runs

bundles                       delivery_plans             agent_services
bundle_items                  delivery_actions           agent_service_metadata
                              delivery_runs              agent_buyers
                              delivery_logs              agent_usage_events

escrow_tasks                  marketplace_listings       auth_accounts
escrow_fundings               risk_profiles              auth_sessions
escrow_submissions            agent_reputations          auth_magic_links
escrow_releases               download_grants            auth_password_credentials
escrow_disputes
escrow_refunds                coupons        invoices    worker_delivery_queue
escrow_reviews                refunds        disputes    worker_webhook_jobs
                              payouts        coupon_redemptions
                              dunning_states              worker_email_ledger
                                                          worker_dunning_attempts
```

The `delivery_runs` / `delivery_actions` / `delivery_logs` tables are the audit
trail for the delivery flow in section 2; the `*_grants` and `saas_*` tables are
the concrete backing for the entitlements in section 1. The `coupons` …
`payouts` tables back the post-payment commerce engines; the `auth_*` tables
back passwordless + password auth; the `worker_*` tables hold the background
worker's queues and idempotency ledgers (see `@settlekit/persistence`).

---

## 6. HTTP API surface

`apps/api` exposes `/v1` resources backed by the domain packages, with a
consistent `{ data }` / `{ error }` envelope:

```text
auth                products            prices              checkout-sessions
payments            customers           subscriptions       entitlements
license-keys        api-keys            bundles             files
webhooks            delivery-runs       delivery-actions    agent-services
escrow              coupons             invoices            refunds
dunning             disputes            payouts

integrations/github  integrations/discord  saas
```

Payment confirmation verifies the transfer on-chain (section 4) before granting
access. The `worker` app — also Postgres-backed via `@settlekit/persistence`
when `DATABASE_URL` is set — consumes the same domain packages to confirm
payments on Arc, execute deliveries, sync GitHub/Discord access, sweep
subscription renewals, send transactional email, and retry webhook deliveries
against that same shared database.
