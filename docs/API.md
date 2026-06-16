# SettleKit REST API Reference

SettleKit is an open-source USDC Commerce OS: sell private repos, SaaS, APIs, AI
tools, license keys, files, and more — and auto-deliver access on payment. This
document is the complete reference for the HTTP API served by `apps/api`.

- **Base URL (local):** `http://localhost:8787`
- **API version prefix:** `/v1`
- **Settlement asset:** USDC (decimal major-unit strings, e.g. `"19.99"`)
- **Content type:** `application/json` for all request and response bodies

---

## Contents

- [Conventions](#conventions)
  - [Response envelope](#response-envelope)
  - [Error envelope](#error-envelope)
  - [Error codes](#error-codes)
  - [Authentication](#authentication)
  - [Money & identifiers](#money--identifiers)
  - [Health check](#health-check)
  - [Configuration](#configuration)
- [Auth](#auth) (`/v1/auth`)
- [Products & Prices](#products--prices) (`/v1/products`)
- [Customers](#customers) (`/v1/customers`)
- [Checkout Sessions](#checkout-sessions) (`/v1/checkout-sessions`)
- [Payments](#payments) (`/v1/payments`)
- [Subscriptions](#subscriptions) (`/v1/subscriptions`)
- [Entitlements](#entitlements) (`/v1/entitlements`)
- [License Keys](#license-keys) (`/v1/license-keys`)
- [API Keys](#api-keys) (`/v1/api-keys`)
- [Coupons](#coupons) (`/v1/coupons`)
- [Invoices](#invoices) (`/v1/invoices`)
- [Refunds](#refunds) (`/v1/refunds`)
- [Dunning](#dunning) (`/v1/dunning`)
- [Disputes](#disputes) (`/v1/disputes`)
- [Payouts](#payouts) (`/v1/payouts`)
- [Bundles](#bundles) (`/v1/bundles`)
- [Agent Services](#agent-services) (`/v1/agent-services`)
- [Marketplace](#marketplace) (`/v1/marketplace`)
- [Usage & Credits](#usage--credits) (`/v1/usage`)
- [Analytics](#analytics) (`/v1/analytics`)
- [Settings](#settings) (`/v1/settings`)
- [Escrow](#escrow) (`/v1/escrow`)
- [Webhooks](#webhooks) (`/v1/webhooks`)
- [Files](#files) (`/v1/files`)
- [Delivery Runs & Actions](#delivery-runs--actions) (`/v1/delivery-runs`, `/v1/delivery-actions`)
- [SaaS](#saas) (`/v1/saas`)
- [GitHub Integration](#github-integration) (`/v1/integrations/github`, `/v1/github/access`)
- [Discord Integration](#discord-integration) (`/v1/integrations/discord`, `/v1/discord/access`)
- [x402 Paid Endpoints](#x402-paid-endpoints) (`/v1/paid/*`)

---

## Conventions

### Response envelope

Every successful response is wrapped in a `data` envelope:

```json
{ "data": <payload> }
```

Mutations that create a resource return HTTP `201 Created`; reads and other
mutations return HTTP `200 OK`. Two endpoints return raw (non-enveloped)
payloads by design and are noted inline:

- `GET /v1/agent-services/:id/metadata.json` — raw machine-readable metadata JSON.
- `GET /v1/invoices/:id.html` — rendered HTML (`text/html`).

### Error envelope

Every error response uses the `error` envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "product not found",
    "details": { "id": "prod_123" }
  }
}
```

`details` is optional and only present when the error carries structured
context. Unhandled routes return a uniform `404`:

```json
{ "error": { "code": "not_found", "message": "No route for GET /v1/nope" } }
```

### Error codes

The HTTP status is derived from the error `code`:

| Code | HTTP | Meaning |
|------|------|---------|
| `validation_error` | 400 | Request body/query failed schema validation, or domain precondition failed. `details` carries Zod field issues. |
| `unauthorized` | 401 | Missing or invalid `Authorization` header / API key / session token. |
| `payment_required` | 402 | An x402 paid resource requires payment (see [x402](#x402-paid-endpoints)). |
| `payment_failed` | 402 | A payment could not be settled. |
| `insufficient_credits` | 402 | Not enough prepaid credits to satisfy the request. |
| `forbidden` | 403 | Authenticated but not allowed to perform the action. |
| `entitlement_expired` | 403 | The entitlement backing the request has expired. |
| `not_found` | 404 | Resource does not exist. |
| `conflict` | 409 | State conflict (e.g. duplicate, illegal lifecycle transition). |
| `rate_limited` | 429 | Too many requests. |
| `delivery_failed` | 500 | A delivery action failed to execute. |
| `internal_error` | 500 | Unexpected server error. |
| `integration_error` | 502 | An upstream integration (GitHub, Discord, chain RPC, etc.) failed. |

Validation errors include the failing fields under `details`:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request body failed validation",
    "details": {
      "issues": [
        { "code": "invalid_type", "path": ["amount"], "message": "Required" }
      ]
    }
  }
}
```

### Authentication

All `/v1` resource endpoints are guarded by a Bearer **API key**:

```
Authorization: Bearer <apiKey>
```

Two route groups are intentionally **public** (no API key):

- `/v1/auth/*` — sign-up / sign-in use a **session token**, not an API key.
- `/v1/paid/*` — x402 paid endpoints; the USDC payment itself is the
  authorization. They return `402 Payment Required` until paid.

For local development and tests a bootstrap key can be configured via the
`API_BOOTSTRAP_KEY` environment variable; presenting it as the Bearer token
authenticates without any key existing in the store.

> The session token returned by `/v1/auth/login` is **not** an API key and
> cannot be used as `Authorization: Bearer <apiKey>` on resource routes. Issue
> an API key via [`POST /v1/api-keys`](#api-keys) for programmatic access.

### Money & identifiers

- **Money** is always a decimal major-unit string in USDC: `"0.005"`, `"19.99"`.
  A `Money` object is `{ "amount": "19.99", "currency": "USDC" }`.
- **IDs** are prefixed and opaque, e.g. `prod_…`, `price_…`, `customer_…`,
  `cs_…`, `pay_…`, `sub_…`, `ent_…`.
- **Timestamps** are ISO-8601 strings (`2026-06-16T12:00:00.000Z`).

### Health check

```
GET /health
```

Unauthenticated liveness probe.

```bash
curl http://localhost:8787/health
```

```json
{ "data": { "status": "ok", "service": "settlekit-api" } }
```

### Configuration

The API reads configuration from environment variables. Persistence is
dual-backend: when `DATABASE_URL` is set the API uses real Postgres via
`@settlekit/persistence` (drizzle, document-projection); when unset it uses an
in-memory backend. On-chain USDC verification is enabled only when Arc is
configured (`ARC_RPC_URL`).

| Variable | Purpose |
|----------|---------|
| `PORT` | API listen port (default `8787`). |
| `DATABASE_URL` | Postgres connection string; unset → in-memory persistence. |
| `API_BOOTSTRAP_KEY` | Static Bearer key that authenticates without the key store. |
| `AUTH_COOKIE_SECRET` | HMAC secret for the signed `sk_session` cookie. |
| `LICENSE_TOKEN_SECRET` | Signing secret for offline license validation tokens. |
| `WEBHOOK_SIGNING_SECRET` | Default webhook signing secret. |
| `ARC_RPC_URL`, `ARC_CHAIN_ID`, `ARC_USDC_ADDRESS`, `ARC_MIN_CONFIRMATIONS` | Arc on-chain USDC settlement/verification. |
| `CIRCLE_API_KEY`, `CIRCLE_BASE_URL` | Circle settlement rail. |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_INSTALLATION_ID`, `GITHUB_WEBHOOK_SECRET` | GitHub App integration. |
| `DISCORD_BOT_TOKEN` | Discord bot for role delivery. |
| `FILE_DOWNLOAD_BASE_URL`, `FILE_DOWNLOAD_SECRET`, `FILE_DOWNLOAD_EXPIRES_SEC`, `FILE_DOWNLOAD_MAX_DOWNLOADS` | Signed file-download issuance. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email (magic links, receipts). |
| `MERCHANT_NAME`, `MERCHANT_EMAIL`, `MERCHANT_WEBSITE` | Merchant identity on invoices. |
| `X402_PAY_TO` | Destination address advertised by `/v1/paid/research`. |

Apply Postgres migrations with:

```bash
pnpm --filter @settlekit/database db:migrate
# or
make db-migrate
```

---

## Auth

Public routes under `/v1/auth` (no API key). On every successful sign-in the
opaque session token is returned in the body **and** written to a signed,
HTTP-only `sk_session` cookie. The `GET /session` and `POST /logout` endpoints
take the session token as a Bearer header.

### POST /v1/auth/register

Create a password account and immediately open a session. **Public.**

Body:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | |
| `password` | string | yes | |
| `type` | `"merchant"` \| `"customer"` | yes | |
| `organizationId` | string | no | |
| `displayName` | string | no | |

```bash
curl -X POST http://localhost:8787/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@acme.dev","password":"s3cret-pass","type":"merchant","displayName":"Acme"}'
```

```json
{
  "data": {
    "account": {
      "id": "acct_01H...",
      "type": "merchant",
      "email": "owner@acme.dev",
      "displayName": "Acme",
      "createdAt": "2026-06-16T12:00:00.000Z"
    },
    "sessionToken": "sess_3f9a..."
  }
}
```

### POST /v1/auth/login

Verify credentials and open a session. **Public.**

```bash
curl -X POST http://localhost:8787/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@acme.dev","password":"s3cret-pass"}'
```

```json
{
  "data": {
    "account": { "id": "acct_01H...", "type": "merchant", "email": "owner@acme.dev" },
    "sessionToken": "sess_3f9a..."
  }
}
```

Invalid credentials return `401 unauthorized`.

### POST /v1/auth/magic-link/request

Issue a single-use sign-in token. **Public.** When no email transport is
configured the token is returned in the response as `devToken` so the flow stays
testable; otherwise it is emailed and only `{ "ok": true }` is returned.

```bash
curl -X POST http://localhost:8787/v1/auth/magic-link/request \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@acme.dev"}'
```

```json
{ "data": { "ok": true, "devToken": "ml_8c1d..." } }
```

### POST /v1/auth/magic-link/complete

Consume a magic-link token and open a session. **Public.**

```bash
curl -X POST http://localhost:8787/v1/auth/magic-link/complete \
  -H "Content-Type: application/json" \
  -d '{"token":"ml_8c1d..."}'
```

```json
{
  "data": {
    "account": { "id": "acct_01H...", "type": "merchant", "email": "owner@acme.dev" },
    "sessionToken": "sess_77b2..."
  }
}
```

### GET /v1/auth/session

Resolve the account for a session token. **Auth:** `Bearer <sessionToken>`.

```bash
curl http://localhost:8787/v1/auth/session \
  -H "Authorization: Bearer sess_3f9a..."
```

```json
{ "data": { "account": { "id": "acct_01H...", "type": "merchant", "email": "owner@acme.dev" } } }
```

### POST /v1/auth/logout

Revoke the session token (idempotent) and clear the cookie. **Auth:** `Bearer <sessionToken>`.

```bash
curl -X POST http://localhost:8787/v1/auth/logout \
  -H "Authorization: Bearer sess_3f9a..."
```

```json
{ "data": { "ok": true } }
```

---

## Products & Prices

`/v1/products` — **Auth required.** A product is created as a draft, then
published once it has an active price.

Product `type` (one of): `saas_plan`, `github_repo_access`,
`github_org_team_access`, `api_access`, `paid_api_call`, `ai_agent_service`,
`digital_download`, `code_template`, `dataset`, `license_key`,
`private_package`, `discord_access`, `support_plan`, `course_or_content`,
`consulting_slot`, `escrow_task`, `bundle`.

Delivery `deliveryMode` (one of): `github_invite`, `github_team_add`,
`license_key`, `api_key`, `file_download`, `discord_role`, `saas_entitlement`,
`webhook`, `email`, `bundle`, `none`.

### POST /v1/products

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `merchantId` | string | yes | |
| `organizationId` | string | yes | |
| `name` | string | yes | |
| `description` | string | no | `""` |
| `type` | product type | yes | |
| `deliveryMode` | delivery mode | yes | |
| `metadata` | object | no | `{}` |

```bash
curl -X POST http://localhost:8787/v1/products \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "merchantId":"acct_01H...","organizationId":"org_1",
    "name":"Pro Repo Access","type":"github_repo_access",
    "deliveryMode":"github_invite"
  }'
```

```json
{
  "data": {
    "id": "prod_5d2c...",
    "merchantId": "acct_01H...",
    "organizationId": "org_1",
    "name": "Pro Repo Access",
    "description": "",
    "type": "github_repo_access",
    "deliveryMode": "github_invite",
    "status": "draft",
    "metadata": {},
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

### GET /v1/products

List all products.

```bash
curl http://localhost:8787/v1/products -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "prod_5d2c...", "name": "Pro Repo Access", "status": "draft" } ] }
```

### GET /v1/products/:id

```bash
curl http://localhost:8787/v1/products/prod_5d2c... -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "prod_5d2c...", "name": "Pro Repo Access", "status": "draft" } }
```

`404 not_found` when the product does not exist.

### POST /v1/products/:id/publish

Publish a product. Requires at least one active price on the product.

```bash
curl -X POST http://localhost:8787/v1/products/prod_5d2c.../publish \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "prod_5d2c...", "status": "active" } }
```

### POST /v1/products/:id/prices

Create a price for a product.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `amount` | string | yes | | Decimal, e.g. `"19.99"`. |
| `currency` | `"USDC"` | no | `"USDC"` | |
| `interval` | `"one_time"` \| `"monthly"` \| `"yearly"` | no | `"one_time"` | |
| `usageBased` | boolean | no | `false` | |
| `unitAmount` | string | no | | Per-unit price for usage-based billing. |
| `creditsGranted` | integer > 0 | no | | Prepaid credits granted on purchase. |

```bash
curl -X POST http://localhost:8787/v1/products/prod_5d2c.../prices \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"amount":"19.99","interval":"monthly"}'
```

```json
{
  "data": {
    "id": "price_a18f...",
    "productId": "prod_5d2c...",
    "amount": "19.99",
    "currency": "USDC",
    "interval": "monthly",
    "usageBased": false,
    "active": true,
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

### GET /v1/products/:id/prices

List prices for a product.

```bash
curl http://localhost:8787/v1/products/prod_5d2c.../prices -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "price_a18f...", "amount": "19.99", "interval": "monthly", "active": true } ] }
```

---

## Customers

`/v1/customers` — **Auth required.** Customers carry the external identity hooks
(`githubUsername`, `discordUserId`, `walletAddress`) that delivery actions
consume.

### POST /v1/customers

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `email` | string (email) | yes | |
| `name` | string | no | |
| `walletAddress` | string | no | |
| `githubUsername` | string | no | |
| `discordUserId` | string | no | |
| `metadata` | object | no | `{}` |

```bash
curl -X POST http://localhost:8787/v1/customers \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","email":"buyer@dev.io","githubUsername":"octocat"}'
```

```json
{
  "data": {
    "id": "customer_9a3b...",
    "organizationId": "org_1",
    "email": "buyer@dev.io",
    "githubUsername": "octocat",
    "metadata": {},
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

### GET /v1/customers

List all customers.

```bash
curl http://localhost:8787/v1/customers -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/customers/:id

```bash
curl http://localhost:8787/v1/customers/customer_9a3b... -H "Authorization: Bearer $SK_API_KEY"
```

`404 not_found` when missing.

---

## Checkout Sessions

`/v1/checkout-sessions` — **Auth required.** Resolves each line item's price,
computes the total, and persists an open session. Networks: `arc`, `base`,
`ethereum`.

### POST /v1/checkout-sessions

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `organizationId` | string | yes | |
| `merchantId` | string | yes | |
| `customerId` | string | no | Required before recording a payment. |
| `items` | array | yes (min 1) | Each: `{ priceId, quantity?, productId?, bundleId? }`. |
| `payToAddress` | string | yes | Address that must receive USDC. |
| `network` | `arc` \| `base` \| `ethereum` | yes | |
| `successUrl` | string (url) | no | |
| `cancelUrl` | string (url) | no | |
| `collectedFields` | object<string,string> | no | Buyer delivery fields. |
| `ttlDays` | integer > 0 | no | |

```bash
curl -X POST http://localhost:8787/v1/checkout-sessions \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"org_1","merchantId":"acct_01H...",
    "customerId":"customer_9a3b...",
    "items":[{"priceId":"price_a18f...","productId":"prod_5d2c...","quantity":1}],
    "payToAddress":"0xMerchantWallet","network":"arc"
  }'
```

```json
{
  "data": {
    "id": "cs_2b7e...",
    "organizationId": "org_1",
    "merchantId": "acct_01H...",
    "customerId": "customer_9a3b...",
    "status": "open",
    "amount": { "amount": "19.99", "currency": "USDC" },
    "network": "arc",
    "payToAddress": "0xMerchantWallet",
    "lineItems": [ { "priceId": "price_a18f...", "productId": "prod_5d2c...", "quantity": 1 } ],
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

A missing `priceId` returns `400 validation_error`.

### GET /v1/checkout-sessions/:id

```bash
curl http://localhost:8787/v1/checkout-sessions/cs_2b7e... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/checkout-sessions/:id/collect-fields

Merge buyer-supplied delivery fields into an open session.

```bash
curl -X POST http://localhost:8787/v1/checkout-sessions/cs_2b7e.../collect-fields \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"fields":{"githubUsername":"octocat"}}'
```

```json
{ "data": { "id": "cs_2b7e...", "collectedFields": { "githubUsername": "octocat" } } }
```

### POST /v1/checkout-sessions/:id/cancel

```bash
curl -X POST http://localhost:8787/v1/checkout-sessions/cs_2b7e.../cancel \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "cs_2b7e...", "status": "canceled" } }
```

### POST /v1/checkout-sessions/:id/expire

```bash
curl -X POST http://localhost:8787/v1/checkout-sessions/cs_2b7e.../expire \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "cs_2b7e...", "status": "expired" } }
```

---

## Payments

`/v1/payments` — **Auth required.** The core money + access flow: record →
confirm (grants entitlements) → optionally refund. When Arc is configured
(`ARC_RPC_URL`) and the payment network is `arc`, confirmation verifies the USDC
transfer **on-chain** before completing.

### POST /v1/payments

Record a pending payment against a checkout session. The session must have a
`customerId`.

| Field | Type | Required |
|-------|------|----------|
| `checkoutSessionId` | string | yes |
| `txHash` | string | no |

```bash
curl -X POST http://localhost:8787/v1/payments \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"checkoutSessionId":"cs_2b7e..."}'
```

```json
{
  "data": {
    "id": "pay_4c9d...",
    "organizationId": "org_1",
    "checkoutSessionId": "cs_2b7e...",
    "customerId": "customer_9a3b...",
    "amount": { "amount": "19.99", "currency": "USDC" },
    "network": "arc",
    "status": "pending",
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

A session without `customerId` returns `400 validation_error`.

### GET /v1/payments/:id

```bash
curl http://localhost:8787/v1/payments/pay_4c9d... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/payments/:id/confirm

Confirm a payment with at least the minimum confirmations. Completes the
checkout session and grants one entitlement per line-item product. On Arc with
verification configured, the on-chain transfer is validated against the
session's `payToAddress` and amount; a mismatch returns `400 validation_error`.

| Field | Type | Required |
|-------|------|----------|
| `txHash` | string | yes |
| `confirmations` | integer ≥ 0 | yes |
| `minConfirmations` | integer > 0 | no |

```bash
curl -X POST http://localhost:8787/v1/payments/pay_4c9d.../confirm \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"txHash":"0xabc123...","confirmations":12,"minConfirmations":6}'
```

```json
{
  "data": {
    "payment": {
      "id": "pay_4c9d...",
      "status": "confirmed",
      "txHash": "0xabc123...",
      "confirmedAt": "2026-06-16T12:01:00.000Z"
    },
    "entitlements": [
      {
        "id": "ent_77aa...",
        "customerId": "customer_9a3b...",
        "productId": "prod_5d2c...",
        "status": "active",
        "grantedBy": { "type": "payment", "id": "pay_4c9d..." }
      }
    ]
  }
}
```

### POST /v1/payments/:id/fail

Mark a pending payment failed.

```bash
curl -X POST http://localhost:8787/v1/payments/pay_4c9d.../fail \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "pay_4c9d...", "status": "failed" } }
```

### POST /v1/payments/:id/refund

Refund a confirmed payment.

```bash
curl -X POST http://localhost:8787/v1/payments/pay_4c9d.../refund \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "pay_4c9d...", "status": "refunded" } }
```

---

## Subscriptions

`/v1/subscriptions` — **Auth required.** Created from a recurring price; grants a
subscription entitlement on creation.

### POST /v1/subscriptions

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `productId` | string | yes | |
| `priceId` | string | yes | Must be a recurring (`monthly`/`yearly`) price. |
| `cancelAtPeriodEnd` | boolean | no | |

```bash
curl -X POST http://localhost:8787/v1/subscriptions \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_5d2c...","priceId":"price_a18f..."}'
```

```json
{
  "data": {
    "subscription": {
      "id": "sub_6e1a...",
      "customerId": "customer_9a3b...",
      "productId": "prod_5d2c...",
      "priceId": "price_a18f...",
      "status": "active",
      "currentPeriodEnd": "2026-07-16T12:00:00.000Z"
    },
    "entitlement": { "id": "ent_8b2c...", "status": "active", "grantedBy": { "type": "subscription", "id": "sub_6e1a..." } }
  }
}
```

A one-time price returns `400 validation_error`.

### GET /v1/subscriptions/:id

```bash
curl http://localhost:8787/v1/subscriptions/sub_6e1a... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/subscriptions/:id/renew

Renew for one more period (interval derived from the price).

```bash
curl -X POST http://localhost:8787/v1/subscriptions/sub_6e1a.../renew \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "sub_6e1a...", "status": "active", "currentPeriodEnd": "2026-08-16T12:00:00.000Z" } }
```

### POST /v1/subscriptions/:id/cancel

```bash
curl -X POST http://localhost:8787/v1/subscriptions/sub_6e1a.../cancel \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "sub_6e1a...", "status": "canceled" } }
```

---

## Entitlements

`/v1/entitlements` — **Auth required.** The universal access layer. The
hot-path `verify` endpoint is what SDKs call to gate access.

### GET /v1/entitlements

List a customer's entitlements.

| Query param | Type | Required | Notes |
|-------------|------|----------|-------|
| `customerId` | string | yes | |
| `activeOnly` | `"true"` | no | Active entitlements only. |
| `productId` | string | no | Filter to a product. |

```bash
curl "http://localhost:8787/v1/entitlements?customerId=customer_9a3b...&activeOnly=true" \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "ent_77aa...", "productId": "prod_5d2c...", "status": "active" } ] }
```

### POST /v1/entitlements/verify

Verify access by feature flag, credits, and/or product. Body must be **strict**
(no unknown keys).

| Field | Type | Required |
|-------|------|----------|
| `customerId` | string | yes |
| `productId` | string | no |
| `feature` | string | no |
| `requiredCredits` | integer > 0 | no |

```bash
curl -X POST http://localhost:8787/v1/entitlements/verify \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"customerId":"customer_9a3b...","productId":"prod_5d2c..."}'
```

```json
{ "data": { "granted": true, "entitlementId": "ent_77aa...", "creditsRemaining": null } }
```

### POST /v1/entitlements/spend-credits

Spend credits against a product entitlement.

| Field | Type | Required |
|-------|------|----------|
| `customerId` | string | yes |
| `productId` | string | yes |
| `amount` | integer > 0 | yes |

```bash
curl -X POST http://localhost:8787/v1/entitlements/spend-credits \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"customerId":"customer_9a3b...","productId":"prod_5d2c...","amount":1}'
```

```json
{ "data": { "id": "ent_77aa...", "creditsRemaining": 99 } }
```

### GET /v1/entitlements/:id

```bash
curl http://localhost:8787/v1/entitlements/ent_77aa... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/entitlements/:id/revoke

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `reason` | string | no | `"revoked via API"` |

```bash
curl -X POST http://localhost:8787/v1/entitlements/ent_77aa.../revoke \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason":"chargeback"}'
```

```json
{ "data": { "id": "ent_77aa...", "status": "revoked", "revokedReason": "chargeback" } }
```

---

## License Keys

`/v1/license-keys` — **Auth required.** Machine/domain-limited keys with offline
validation tokens.

### POST /v1/license-keys

Issue a license key.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `productId` | string | yes | |
| `entitlementId` | string | yes | |
| `machineLimit` | integer > 0 | no | `1` |
| `domainLimit` | integer > 0 | no | |
| `expiresAt` | datetime | no | |

```bash
curl -X POST http://localhost:8787/v1/license-keys \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_5d2c...","entitlementId":"ent_77aa...","machineLimit":3}'
```

```json
{
  "data": {
    "id": "lk_2a44...",
    "key": "SK-LICN-XXXX-YYYY-ZZZZ",
    "productId": "prod_5d2c...",
    "machineLimit": 3,
    "status": "active",
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

### POST /v1/license-keys/verify

Verify a license key for a product + machine (activates the machine when new and
within capacity).

| Field | Type | Required |
|-------|------|----------|
| `licenseKey` | string | yes |
| `productId` | string | yes |
| `machineId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/license-keys/verify \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"licenseKey":"SK-LICN-XXXX-YYYY-ZZZZ","productId":"prod_5d2c...","machineId":"machine-01"}'
```

```json
{ "data": { "valid": true, "license": { "id": "lk_2a44...", "machineCount": 1, "machineLimit": 3 } } }
```

### POST /v1/license-keys/:id/token

Mint an offline validation token for an existing license.

```bash
curl -X POST http://localhost:8787/v1/license-keys/lk_2a44.../token \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "token": "eyJhbGci..." } }
```

### POST /v1/license-keys/:id/revoke

```bash
curl -X POST http://localhost:8787/v1/license-keys/lk_2a44.../revoke \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "lk_2a44...", "status": "revoked" } }
```

---

## API Keys

`/v1/api-keys` — **Auth required.** Issues scoped keys for a customer's
entitlement. The plaintext secret is returned **exactly once** on issuance; only
its SHA-256 hash is stored.

### POST /v1/api-keys

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `productId` | string | yes | |
| `entitlementId` | string | yes | |
| `scopes` | string[] | yes (min 1) | |
| `env` | `"live"` \| `"test"` | no | `"live"` |

```bash
curl -X POST http://localhost:8787/v1/api-keys \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_5d2c...","entitlementId":"ent_77aa...","scopes":["read:data"],"env":"live"}'
```

```json
{
  "data": {
    "apiKey": { "id": "ak_5f8b...", "prefix": "sk_live_", "scopes": ["read:data"], "env": "live" },
    "plaintext": "sk_live_3f9a2c8e..."
  }
}
```

### POST /v1/api-keys/verify

Verify a presented key, optionally enforcing required scopes.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `key` | string | yes | |
| `requiredScopes` | string[] | no | `[]` |

```bash
curl -X POST http://localhost:8787/v1/api-keys/verify \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"key":"sk_live_3f9a2c8e...","requiredScopes":["read:data"]}'
```

```json
{ "data": { "valid": true, "apiKey": { "id": "ak_5f8b...", "scopes": ["read:data"] } } }
```

### POST /v1/api-keys/revoke

Revoke a key by its plaintext.

```bash
curl -X POST http://localhost:8787/v1/api-keys/revoke \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"key":"sk_live_3f9a2c8e..."}'
```

```json
{ "data": { "id": "ak_5f8b...", "status": "revoked" } }
```

---

## Coupons

`/v1/coupons` — **Auth required.** Discount engine. Discounts are one of:
`{ "type": "percent", "percentOff": 1-100 }`,
`{ "type": "amount", "amountOff": "5.00" }`, or
`{ "type": "free-trial-days", "days": 14 }`.

### POST /v1/coupons

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `code` | string | yes | |
| `name` | string | no | |
| `discount` | object | yes | One of the discount shapes above. |
| `status` | `"active"` \| `"archived"` | no | |
| `startsAt` | datetime | no | |
| `expiresAt` | datetime | no | |
| `maxRedemptions` | integer ≥ 1 | no | |
| `perCustomerLimit` | integer ≥ 1 | no | |
| `minSubtotal` | string | no | |
| `appliesToProductIds` | string[] | no | |

```bash
curl -X POST http://localhost:8787/v1/coupons \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"code":"LAUNCH20","discount":{"type":"percent","percentOff":20},"maxRedemptions":100}'
```

```json
{ "data": { "code": "LAUNCH20", "discount": { "type": "percent", "percentOff": 20 }, "status": "active", "redemptionCount": 0 } }
```

### GET /v1/coupons

```bash
curl http://localhost:8787/v1/coupons -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/coupons/:code

```bash
curl http://localhost:8787/v1/coupons/LAUNCH20 -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/coupons/:code/validate

Dry-run apply against a subtotal (does not change the redemption count).

| Field | Type | Required |
|-------|------|----------|
| `subtotal` | string | yes |
| `customerId` | string | no |

```bash
curl -X POST http://localhost:8787/v1/coupons/LAUNCH20/validate \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"subtotal":"100.00","customerId":"customer_9a3b..."}'
```

```json
{ "data": { "valid": true, "discountAmount": { "amount": "20.00", "currency": "USDC" }, "total": { "amount": "80.00", "currency": "USDC" } } }
```

### POST /v1/coupons/:code/redeem

Same body as `validate`, but increments the redemption count.

```bash
curl -X POST http://localhost:8787/v1/coupons/LAUNCH20/redeem \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"subtotal":"100.00","customerId":"customer_9a3b..."}'
```

```json
{ "data": { "coupon": { "code": "LAUNCH20", "redemptionCount": 1 }, "total": { "amount": "80.00", "currency": "USDC" } } }
```

---

## Invoices

`/v1/invoices` — **Auth required.** Lifecycle: `draft → open → paid` (or `void`).

### POST /v1/invoices

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `lineItems` | array | no | Each: `{ description, quantity (≥1), unitAmount }`. |
| `discount` | string | no | |
| `taxRate` | object | no | `{ jurisdiction, rateBps (0-10000), inclusive? }`. |
| `dueAt` | datetime | no | |
| `metadata` | object<string,string> | no | |

```bash
curl -X POST http://localhost:8787/v1/invoices \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"org_1","customerId":"customer_9a3b...",
    "lineItems":[{"description":"Pro plan","quantity":1,"unitAmount":"19.99"}],
    "taxRate":{"jurisdiction":"US-CA","rateBps":875}
  }'
```

```json
{
  "data": {
    "id": "inv_3c7d...",
    "status": "draft",
    "customerId": "customer_9a3b...",
    "lineItems": [ { "description": "Pro plan", "quantity": 1, "unitAmount": { "amount": "19.99", "currency": "USDC" } } ],
    "total": { "amount": "21.74", "currency": "USDC" }
  }
}
```

### GET /v1/invoices

| Query param | Type | Required |
|-------------|------|----------|
| `customerId` | string | no |

```bash
curl "http://localhost:8787/v1/invoices?customerId=customer_9a3b..." -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/invoices/:id

```bash
curl http://localhost:8787/v1/invoices/inv_3c7d... -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/invoices/:id.html

Render the styled HTML invoice. Returns `text/html` (not an enveloped JSON body).

```bash
curl http://localhost:8787/v1/invoices/inv_3c7d....html -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/invoices/:id/finalize

`draft → open`.

```bash
curl -X POST http://localhost:8787/v1/invoices/inv_3c7d.../finalize -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "inv_3c7d...", "status": "open" } }
```

### POST /v1/invoices/:id/pay

`open → paid`.

```bash
curl -X POST http://localhost:8787/v1/invoices/inv_3c7d.../pay -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "inv_3c7d...", "status": "paid" } }
```

### POST /v1/invoices/:id/void

`draft|open → void`.

```bash
curl -X POST http://localhost:8787/v1/invoices/inv_3c7d.../void -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "inv_3c7d...", "status": "void" } }
```

---

## Refunds

`/v1/refunds` — **Auth required.** Creation looks up the backing payment by
`paymentId` to validate the refundable remaining amount.

### POST /v1/refunds

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `paymentId` | string | yes | Must reference an existing payment. |
| `customerId` | string | yes | |
| `amount` | string | yes | |
| `reason` | `duplicate` \| `fraudulent` \| `customer_request` \| `delivery_failed` | yes | |
| `originalAmount` | string | no | Hint only; the backing payment is authoritative. |

```bash
curl -X POST http://localhost:8787/v1/refunds \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"paymentId":"pay_4c9d...","customerId":"customer_9a3b...","amount":"19.99","reason":"customer_request"}'
```

```json
{ "data": { "id": "ref_9d2e...", "paymentId": "pay_4c9d...", "amount": { "amount": "19.99", "currency": "USDC" }, "reason": "customer_request", "status": "pending" } }
```

`404 not_found` when `paymentId` is unknown.

### GET /v1/refunds

List by `paymentId` or `customerId`; with neither, lists all.

| Query param | Type | Required |
|-------------|------|----------|
| `paymentId` | string | no |
| `customerId` | string | no |

```bash
curl "http://localhost:8787/v1/refunds?paymentId=pay_4c9d..." -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/refunds/:id/succeed

`pending → succeeded`.

```bash
curl -X POST http://localhost:8787/v1/refunds/ref_9d2e.../succeed -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "ref_9d2e...", "status": "succeeded" } }
```

### POST /v1/refunds/:id/fail

`pending → failed`.

| Field | Type | Required |
|-------|------|----------|
| `reason` | string | no |

```bash
curl -X POST http://localhost:8787/v1/refunds/ref_9d2e.../fail \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason":"insufficient liquidity"}'
```

```json
{ "data": { "id": "ref_9d2e...", "status": "failed" } }
```

---

## Dunning

`/v1/dunning` — **Auth required.** Failed-payment recovery campaigns keyed by
subscription.

### POST /v1/dunning

Start a campaign for a subscription.

| Field | Type | Required |
|-------|------|----------|
| `subscriptionId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/dunning \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"subscriptionId":"sub_6e1a..."}'
```

```json
{ "data": { "subscriptionId": "sub_6e1a...", "status": "active", "attempts": 0 } }
```

### GET /v1/dunning

List active campaigns, or only those due for retry with `?due=true` (or `?due=1`).

```bash
curl "http://localhost:8787/v1/dunning?due=true" -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/dunning/:subscriptionId/attempt

Record a retry attempt outcome. `recovered` closes the campaign; `failed`
advances or exhausts it.

| Field | Type | Required |
|-------|------|----------|
| `outcome` | `"recovered"` \| `"failed"` | yes |
| `failureReason` | string | no |

```bash
curl -X POST http://localhost:8787/v1/dunning/sub_6e1a.../attempt \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"outcome":"failed","failureReason":"insufficient funds"}'
```

```json
{ "data": { "subscriptionId": "sub_6e1a...", "status": "active", "attempts": 1 } }
```

### POST /v1/dunning/:subscriptionId/recover

Mark a campaign recovered.

```bash
curl -X POST http://localhost:8787/v1/dunning/sub_6e1a.../recover -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "subscriptionId": "sub_6e1a...", "status": "recovered" } }
```

---

## Disputes

`/v1/disputes` — **Auth required.** Chargeback / dispute engine.

### POST /v1/disputes

Open a dispute.

| Field | Type | Required |
|-------|------|----------|
| `paymentId` | string | yes |
| `customerId` | string | yes |
| `reason` | `fraud` \| `not_received` \| `duplicate` \| `quality` \| `unrecognized` | yes |

```bash
curl -X POST http://localhost:8787/v1/disputes \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"paymentId":"pay_4c9d...","customerId":"customer_9a3b...","reason":"not_received"}'
```

```json
{ "data": { "id": "dsp_1f4a...", "paymentId": "pay_4c9d...", "reason": "not_received", "status": "open" } }
```

### GET /v1/disputes

List disputes. `?status=open` or `?status=under_review` returns open disputes;
any other `status` filters the full list; no `status` returns all.

```bash
curl "http://localhost:8787/v1/disputes?status=open" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/disputes/:id

```bash
curl http://localhost:8787/v1/disputes/dsp_1f4a... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/disputes/:id/evidence

Attach evidence (moves the dispute to `under_review`).

| Field | Type | Required |
|-------|------|----------|
| `kind` | `text` \| `receipt` \| `shipping` \| `communication` \| `url` \| `file` | yes |
| `description` | string | yes |
| `value` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/disputes/dsp_1f4a.../evidence \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"kind":"text","description":"Delivery log","value":"Repo invite accepted 2026-06-16"}'
```

```json
{ "data": { "id": "dsp_1f4a...", "status": "under_review", "evidence": [ { "kind": "text" } ] } }
```

### POST /v1/disputes/:id/resolve

| Field | Type | Required |
|-------|------|----------|
| `outcome` | `won` \| `lost` \| `refunded` | yes |

```bash
curl -X POST http://localhost:8787/v1/disputes/dsp_1f4a.../resolve \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"outcome":"won"}'
```

```json
{ "data": { "id": "dsp_1f4a...", "status": "won" } }
```

---

## Payouts

`/v1/payouts` — **Auth required.** Merchant settlement. Available balance is
computed from the org's confirmed payments minus prior (pending or paid)
payouts.

### POST /v1/payouts

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `walletAddress` | string | yes |
| `amount` | string | yes |
| `network` | `arc` \| `base` \| `ethereum` | yes |

```bash
curl -X POST http://localhost:8787/v1/payouts \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","walletAddress":"0xMerchantWallet","amount":"500.00","network":"arc"}'
```

```json
{ "data": { "id": "po_8a2c...", "organizationId": "org_1", "amount": { "amount": "500.00", "currency": "USDC" }, "network": "arc", "status": "pending" } }
```

### GET /v1/payouts

List payouts. With `?organizationId=` filters to one org; without it, lists all.

```bash
curl "http://localhost:8787/v1/payouts?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/payouts/balance

Available balance for an org.

| Query param | Type | Required |
|-------------|------|----------|
| `organizationId` | string | yes |

```bash
curl "http://localhost:8787/v1/payouts/balance?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "available": { "amount": "1250.00", "currency": "USDC" } } }
```

### POST /v1/payouts/:id/paid

Mark paid with an on-chain `txHash`.

```bash
curl -X POST http://localhost:8787/v1/payouts/po_8a2c.../paid \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"txHash":"0xpayout..."}'
```

```json
{ "data": { "id": "po_8a2c...", "status": "paid", "txHash": "0xpayout..." } }
```

### POST /v1/payouts/:id/fail

| Field | Type | Required |
|-------|------|----------|
| `reason` | string | no |

```bash
curl -X POST http://localhost:8787/v1/payouts/po_8a2c.../fail \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason":"address rejected"}'
```

```json
{ "data": { "id": "po_8a2c...", "status": "failed" } }
```

---

## Bundles

`/v1/bundles` — **Auth required.** Group multiple products into one purchasable
bundle. Validation (non-empty, no duplicates/cycles, all products exist) runs in
the service.

### POST /v1/bundles

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `merchantId` | string | yes | |
| `organizationId` | string | yes | |
| `name` | string | yes | |
| `description` | string | no | |
| `productIds` | string[] | yes (min 1) | |
| `amount` | string | no | Bundle price; when omitted, member prices default. |
| `interval` | `one_time` \| `monthly` \| `yearly` | no | |

```bash
curl -X POST http://localhost:8787/v1/bundles \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"merchantId":"acct_01H...","organizationId":"org_1","name":"Starter Pack","productIds":["prod_5d2c...","prod_8e1f..."],"amount":"49.00"}'
```

```json
{ "data": { "id": "bndl_4f2a...", "name": "Starter Pack", "productIds": ["prod_5d2c...","prod_8e1f..."], "status": "draft" } }
```

### GET /v1/bundles

With `?organizationId=` filters to one org.

```bash
curl "http://localhost:8787/v1/bundles?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/bundles/:id

```bash
curl http://localhost:8787/v1/bundles/bndl_4f2a... -H "Authorization: Bearer $SK_API_KEY"
```

### PATCH /v1/bundles/:id

Patch mutable fields. Setting `status` to `archived` archives the bundle.

| Field | Type | Required |
|-------|------|----------|
| `name` | string | no |
| `description` | string | no |
| `status` | `draft` \| `active` \| `archived` | no |

```bash
curl -X PATCH http://localhost:8787/v1/bundles/bndl_4f2a... \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Starter Pack 2026"}'
```

```json
{ "data": { "id": "bndl_4f2a...", "name": "Starter Pack 2026", "status": "draft" } }
```

### POST /v1/bundles/:id/publish

```bash
curl -X POST http://localhost:8787/v1/bundles/bndl_4f2a.../publish -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "bndl_4f2a...", "status": "active" } }
```

---

## Agent Services

`/v1/agent-services` — **Auth required.** Listings for AI/agent tools that other
agents can discover and pay for.

### POST /v1/agent-services

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `merchantId` | string | yes | |
| `productId` | string | yes | |
| `name` | string | yes | |
| `description` | string | yes | |
| `endpoint` | string (url) | yes | |
| `price` | string | yes | |
| `network` | `arc` \| `base` | no | `base` |
| `inputSchema` | object | yes | |
| `outputSchema` | object | no | |

```bash
curl -X POST http://localhost:8787/v1/agent-services \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"org_1","merchantId":"acct_01H...","productId":"prod_ai...",
    "name":"Summarizer","description":"Summarize text","endpoint":"https://api.acme.dev/sum",
    "price":"0.01","inputSchema":{"text":"string"}
  }'
```

```json
{ "data": { "id": "agsvc_2c8d...", "name": "Summarizer", "endpoint": "https://api.acme.dev/sum", "price": "0.01", "network": "base", "status": "draft" } }
```

### GET /v1/agent-services

Discover services. With `?organizationId=` filters to one org.

```bash
curl "http://localhost:8787/v1/agent-services?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/agent-services/:id

```bash
curl http://localhost:8787/v1/agent-services/agsvc_2c8d... -H "Authorization: Bearer $SK_API_KEY"
```

### PATCH /v1/agent-services/:id

| Field | Type | Required |
|-------|------|----------|
| `name` | string | no |
| `description` | string | no |
| `endpoint` | string (url) | no |
| `price` | string | no |

```bash
curl -X PATCH http://localhost:8787/v1/agent-services/agsvc_2c8d... \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"price":"0.02"}'
```

### POST /v1/agent-services/:id/publish

```bash
curl -X POST http://localhost:8787/v1/agent-services/agsvc_2c8d.../publish -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "agsvc_2c8d...", "status": "active" } }
```

### GET /v1/agent-services/:id/metadata.json

Machine-readable metadata document. Returned as **raw JSON** (not wrapped in a
`data` envelope) so agents can consume it directly.

```bash
curl http://localhost:8787/v1/agent-services/agsvc_2c8d.../metadata.json \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{
  "name": "Summarizer",
  "description": "Summarize text",
  "endpoint": "https://api.acme.dev/sum",
  "price": { "amount": "0.02", "currency": "USDC", "network": "base" },
  "inputSchema": { "text": "string" }
}
```

---

## Marketplace

`/v1/marketplace` — **Auth required.** Public product listings + discovery and
seller profiles.

### POST /v1/marketplace/listings

Create an (unpublished) listing.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `merchantId` | string | yes | |
| `productId` | string | yes | |
| `title` | string | yes | |
| `summary` | string | yes | |
| `tags` | string[] | no | `[]` |

```bash
curl -X POST http://localhost:8787/v1/marketplace/listings \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","merchantId":"acct_01H...","productId":"prod_5d2c...","title":"Pro Repo","summary":"Private repo access","tags":["devtools"]}'
```

```json
{ "data": { "id": "lst_7d3a...", "title": "Pro Repo", "tags": ["devtools"], "status": "draft", "ratingAvg": 0, "ratingCount": 0 } }
```

### GET /v1/marketplace/listings

Search published listings. Query params: `q` (text), `tag`, `sort`
(`top` | `new` | `price`).

```bash
curl "http://localhost:8787/v1/marketplace/listings?q=repo&tag=devtools&sort=top" \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "lst_7d3a...", "title": "Pro Repo", "ratingAvg": 4.5 } ] }
```

### GET /v1/marketplace/listings/:id

```bash
curl http://localhost:8787/v1/marketplace/listings/lst_7d3a... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/marketplace/listings/:id/publish

```bash
curl -X POST http://localhost:8787/v1/marketplace/listings/lst_7d3a.../publish -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "lst_7d3a...", "status": "published" } }
```

### POST /v1/marketplace/listings/:id/unpublish

```bash
curl -X POST http://localhost:8787/v1/marketplace/listings/lst_7d3a.../unpublish -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "lst_7d3a...", "status": "draft" } }
```

### POST /v1/marketplace/listings/:id/rate

| Field | Type | Required |
|-------|------|----------|
| `stars` | integer 1-5 | yes |

```bash
curl -X POST http://localhost:8787/v1/marketplace/listings/lst_7d3a.../rate \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"stars":5}'
```

```json
{ "data": { "id": "lst_7d3a...", "ratingAvg": 4.7, "ratingCount": 11 } }
```

### GET /v1/marketplace/sellers/:merchantId

Aggregate seller profile.

```bash
curl http://localhost:8787/v1/marketplace/sellers/acct_01H... -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "merchantId": "acct_01H...", "listings": 3, "ratingAvg": 4.6 } }
```

---

## Usage & Credits

`/v1/usage` — **Auth required.** Metering + prepaid credits. A meter is
identified by `{ organizationId, customerId, productId, metric }`. A credit
balance is identified by `{ organizationId, customerId, productId }`. Optional
`periodStart` (ISO datetime) selects the metering period; it defaults to now.

### POST /v1/usage/record

Record N units of a metric (creates the meter on first use).

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `productId` | string | yes | |
| `metric` | string | yes | |
| `quantity` | integer ≥ 1 | no | `1` |
| `periodStart` | datetime | no | now |

```bash
curl -X POST http://localhost:8787/v1/usage/record \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_api...","metric":"api_calls","quantity":5}'
```

```json
{ "data": { "metric": "api_calls", "quantity": 5, "periodStart": "2026-06-16T00:00:00.000Z" } }
```

### GET /v1/usage/meter

Read the current meter. Query params: `organizationId`, `customerId`,
`productId`, `metric` (all required), `periodStart` (optional).

```bash
curl "http://localhost:8787/v1/usage/meter?organizationId=org_1&customerId=customer_9a3b...&productId=prod_api...&metric=api_calls" \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "metric": "api_calls", "quantity": 5 } }
```

### POST /v1/usage/charge

Compute the charge for a meter's usage at a unit price.

| Field | Type | Required |
|-------|------|----------|
| (meter ref fields) | | yes |
| `unitAmount` | string | yes |
| `periodStart` | datetime | no |

```bash
curl -X POST http://localhost:8787/v1/usage/charge \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_api...","metric":"api_calls","unitAmount":"0.001"}'
```

```json
{ "data": { "quantity": 5, "unitAmount": { "amount": "0.001", "currency": "USDC" }, "total": { "amount": "0.005", "currency": "USDC" } } }
```

### POST /v1/usage/limit

Evaluate usage against a hard limit.

| Field | Type | Required |
|-------|------|----------|
| (meter ref fields) | | yes |
| `limit` | integer ≥ 0 | yes |
| `periodStart` | datetime | no |

```bash
curl -X POST http://localhost:8787/v1/usage/limit \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_api...","metric":"api_calls","limit":1000}'
```

```json
{ "data": { "used": 5, "limit": 1000, "withinLimit": true } }
```

### GET /v1/usage/credits

Read a prepaid balance. Query params: `organizationId`, `customerId`,
`productId` (all required).

```bash
curl "http://localhost:8787/v1/usage/credits?organizationId=org_1&customerId=customer_9a3b...&productId=prod_api..." \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "credits": 100 } }
```

### POST /v1/usage/credits/grant

Grant prepaid credits.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `customerId` | string | yes |
| `productId` | string | yes |
| `credits` | integer ≥ 1 | yes |

```bash
curl -X POST http://localhost:8787/v1/usage/credits/grant \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_api...","credits":100}'
```

```json
{ "data": { "credits": 100 } }
```

### POST /v1/usage/credits/consume

Consume prepaid credits (e.g. meter a paid API call).

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `productId` | string | yes | |
| `credits` | integer ≥ 1 | no | `1` |

```bash
curl -X POST http://localhost:8787/v1/usage/credits/consume \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","productId":"prod_api...","credits":1}'
```

```json
{ "data": { "credits": 99 } }
```

Consuming more than the balance returns `402 insufficient_credits`.

---

## Analytics

`/v1/analytics` — **Auth required.**

### GET /v1/analytics/summary

Merchant dashboard summary computed live from the stores. Query param
`organizationId` (defaults to the platform's default org when omitted).

Fields: `revenue` (sum of confirmed payments), `revenueSeries` (14-day daily
totals), `customers` (count), `activeAccess` (active entitlements), `mrr`
(normalized monthly recurring revenue), `expiringSubscriptions` (in grace or
ending within 7 days), `failedDeliveries` (failed/partially-failed runs).

```bash
curl "http://localhost:8787/v1/analytics/summary?organizationId=org_1" \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{
  "data": {
    "revenue": { "amount": "1250.00", "currency": "USDC" },
    "customers": 42,
    "activeAccess": 38,
    "expiringSubscriptions": 3,
    "failedDeliveries": 1,
    "mrr": { "amount": "640.00", "currency": "USDC" },
    "revenueSeries": [ { "date": "2026-06-03", "amount": 0 }, { "date": "2026-06-16", "amount": 120 } ]
  }
}
```

---

## Settings

`/v1/settings` — **Auth required.** Editable organization config; unknown keys
are ignored and provided keys are merged over current.

### GET /v1/settings

Query param `organizationId` (defaults to the platform default org).

```bash
curl "http://localhost:8787/v1/settings?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "organizationId": "org_1", "orgName": "Acme", "payoutCurrency": "USDC", "defaultRail": "arc" } }
```

### POST /v1/settings

Patch settings.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | no |
| `orgName` | string | no |
| `supportEmail` | string | no |
| `payoutCurrency` | string | no |
| `webhookSecret` | string | no |
| `defaultRail` | `arc` \| `circle` \| `x402` | no |

```bash
curl -X POST http://localhost:8787/v1/settings \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","orgName":"Acme Inc","defaultRail":"arc"}'
```

```json
{ "data": { "organizationId": "org_1", "orgName": "Acme Inc", "defaultRail": "arc" } }
```

---

## Escrow

`/v1/escrow` — **Auth required.** Milestone escrow for agent/consulting work.
Lifecycle: create → fund → assign → submit → approve → release (or refund;
dispute also available).

### POST /v1/escrow/tasks

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `buyerCustomerId` | string | yes | |
| `title` | string | yes | |
| `description` | string | yes | |
| `amount` | string | yes | |
| `currency` | `"USDC"` | no | `"USDC"` |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","buyerCustomerId":"customer_9a3b...","title":"Build landing page","description":"Next.js marketing site","amount":"500.00"}'
```

```json
{ "data": { "id": "esc_3a9c...", "title": "Build landing page", "amount": { "amount": "500.00", "currency": "USDC" }, "status": "created" } }
```

### GET /v1/escrow/tasks

List tasks for an org. Query param `organizationId` is **required**.

```bash
curl "http://localhost:8787/v1/escrow/tasks?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/escrow/tasks/:id

```bash
curl http://localhost:8787/v1/escrow/tasks/esc_3a9c... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/escrow/tasks/:id/fund

| Field | Type | Required |
|-------|------|----------|
| `fundingTxHash` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../fund \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"fundingTxHash":"0xfund..."}'
```

```json
{ "data": { "id": "esc_3a9c...", "status": "funded", "fundingTxHash": "0xfund..." } }
```

### POST /v1/escrow/tasks/:id/assign

| Field | Type | Required |
|-------|------|----------|
| `workerCustomerId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../assign \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"workerCustomerId":"customer_worker..."}'
```

```json
{ "data": { "id": "esc_3a9c...", "status": "assigned", "workerCustomerId": "customer_worker..." } }
```

### POST /v1/escrow/tasks/:id/submit

| Field | Type | Required |
|-------|------|----------|
| `content` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../submit \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"content":"https://github.com/acme/site/pull/1"}'
```

```json
{ "data": { "id": "esc_3a9c...", "status": "submitted" } }
```

### POST /v1/escrow/tasks/:id/approve

No body.

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../approve -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "esc_3a9c...", "status": "approved" } }
```

### POST /v1/escrow/tasks/:id/release

| Field | Type | Required |
|-------|------|----------|
| `releaseTxHash` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../release \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"releaseTxHash":"0xrelease..."}'
```

```json
{ "data": { "id": "esc_3a9c...", "status": "released", "releaseTxHash": "0xrelease..." } }
```

### POST /v1/escrow/tasks/:id/refund

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `reason` | string | no | `"refunded via API"` |

```bash
curl -X POST http://localhost:8787/v1/escrow/tasks/esc_3a9c.../refund \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"reason":"scope canceled"}'
```

```json
{ "data": { "id": "esc_3a9c...", "status": "refunded" } }
```

---

## Webhooks

`/v1/webhooks` — **Auth required.** Register endpoints and emit signed events.

Event types: `payment.confirmed`, `payment.failed`, `payment.refunded`,
`subscription.created`, `subscription.renewed`, `subscription.canceled`,
`entitlement.granted`, `entitlement.revoked`, `delivery.succeeded`,
`delivery.failed`.

### POST /v1/webhooks/endpoints

Register an endpoint with a freshly-minted signing secret (returned once).

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `url` | string (url) | yes |
| `enabledEvents` | event-type[] | yes (min 1) |

```bash
curl -X POST http://localhost:8787/v1/webhooks/endpoints \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","url":"https://acme.dev/hooks","enabledEvents":["payment.confirmed","entitlement.granted"]}'
```

```json
{
  "data": {
    "id": "whe_5b1c...",
    "organizationId": "org_1",
    "url": "https://acme.dev/hooks",
    "signingSecret": "whsec_8f2a...",
    "enabledEvents": ["payment.confirmed","entitlement.granted"],
    "active": true,
    "createdAt": "2026-06-16T12:00:00.000Z"
  }
}
```

### GET /v1/webhooks/endpoints

With `?organizationId=` filters to one org.

```bash
curl "http://localhost:8787/v1/webhooks/endpoints?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/webhooks/events

Emit an event: persist it and return the signed payload + signature for each
matching active endpoint. The signature is computed over the serialized event
with a unix timestamp — exactly what a receiver verifies.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `type` | event type | yes | |
| `data` | object | no | `{}` |

```bash
curl -X POST http://localhost:8787/v1/webhooks/events \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","type":"payment.confirmed","data":{"paymentId":"pay_4c9d..."}}'
```

```json
{
  "data": {
    "event": {
      "id": "evt_9d4a...",
      "type": "payment.confirmed",
      "organizationId": "org_1",
      "data": { "paymentId": "pay_4c9d..." },
      "createdAt": "2026-06-16T12:00:00.000Z"
    },
    "deliveries": [
      { "endpointId": "whe_5b1c...", "url": "https://acme.dev/hooks", "signature": "t=1718539200,v1=ab12cd..." }
    ]
  }
}
```

### GET /v1/webhooks/events

With `?organizationId=` filters to one org.

```bash
curl "http://localhost:8787/v1/webhooks/events?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/webhooks/events/:id

```bash
curl http://localhost:8787/v1/webhooks/events/evt_9d4a... -H "Authorization: Bearer $SK_API_KEY"
```

---

## Files

`/v1/files` — **Auth required.** HMAC-signed, usage-limited download URLs.

### POST /v1/files/downloads

Issue a signed download URL + grant.

| Field | Type | Required |
|-------|------|----------|
| `fileId` | string | yes |
| `customerId` | string | yes |
| `expiresInSec` | integer > 0 | no |
| `maxDownloads` | integer > 0 | no |

```bash
curl -X POST http://localhost:8787/v1/files/downloads \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"fileId":"file_7a2b...","customerId":"customer_9a3b...","expiresInSec":3600,"maxDownloads":3}'
```

```json
{
  "data": {
    "url": "https://downloads.acme.dev/file_7a2b...?exp=1718542800&sig=ab12...",
    "grant": { "fileId": "file_7a2b...", "customerId": "customer_9a3b...", "maxDownloads": 3, "downloadsUsed": 0 }
  }
}
```

### GET /v1/files/download

Redeem a signed download URL. The full signed URL is passed as the `url` query
param; the server verifies the signature/expiry and atomically consumes one
download.

| Query param | Type | Required |
|-------------|------|----------|
| `url` | string | yes |

```bash
curl "http://localhost:8787/v1/files/download?url=https%3A%2F%2Fdownloads.acme.dev%2Ffile_7a2b...%3Fexp%3D1718542800%26sig%3Dab12..." \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "fileId": "file_7a2b...", "downloadsRemaining": 2 } }
```

A missing `url` returns `400 validation_error`; an invalid/expired URL is
rejected by the signed-URL verifier.

---

## Delivery Runs & Actions

**Auth required.** Inspect delivery runs and test individual delivery action
handlers.

### GET /v1/delivery-runs

List runs. Optional query params `organizationId` and `paymentId` filter.

```bash
curl "http://localhost:8787/v1/delivery-runs?organizationId=org_1&paymentId=pay_4c9d..." \
  -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "dr_4f8a...", "paymentId": "pay_4c9d...", "status": "succeeded", "actionRuns": [] } ] }
```

### GET /v1/delivery-runs/:id

```bash
curl http://localhost:8787/v1/delivery-runs/dr_4f8a... -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/delivery-runs/:id/retry

Re-run the failed actions of a run by marking them pending again.

```bash
curl -X POST http://localhost:8787/v1/delivery-runs/dr_4f8a.../retry -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": { "id": "dr_4f8a...", "status": "pending", "actionRuns": [ { "status": "pending", "attempts": 1 } ] } }
```

### POST /v1/delivery-actions/test

Execute a single delivery action through the real handler registry + in-process
clients, returning the handler's actual output.

Context fields (all optional, with defaults): `organizationId` (`org_test`),
`customerId` (`cus_test`), `productId` (`prod_test`), `paymentId` (`pay_test`),
`entitlementId` (`ent_test`), `customerEmail`, `githubInstallationId`,
`githubUsername`, `discordUserId`.

`action` is a discriminated union on `type`:

| `type` | Additional fields |
|--------|-------------------|
| `github_invite` | `repoId`, `permission?` (`pull`/`push`/`maintain`) |
| `github_team_add` | `orgLogin`, `teamSlug` |
| `license_key_create` | `policyId` |
| `api_key_create` | `scopes` (string[], min 1) |
| `file_access_grant` | `fileId` |
| `discord_role_add` | `guildId`, `roleId` |
| `saas_entitlement_create` | `features` (object<string, boolean\|number\|string>) |
| `webhook_send` | `url` |
| `email_send` | `template` |

```bash
curl -X POST http://localhost:8787/v1/delivery-actions/test \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "githubInstallationId":12345,"githubUsername":"octocat",
    "action":{"type":"github_invite","repoId":"acme/private-repo","permission":"push"}
  }'
```

```json
{
  "data": {
    "action": { "type": "github_invite", "repoId": "acme/private-repo", "permission": "push" },
    "status": "succeeded",
    "output": { "invited": "octocat", "repo": "acme/private-repo", "permission": "push" }
  }
}
```

An unknown action type returns `404 not_found`; a handler failure surfaces the
handler's own error, otherwise `400 validation_error`.

---

## SaaS

`/v1/saas` — **Auth required.** Plans, feature-bearing tenant entitlements,
feature verification, and seat management.

### POST /v1/saas/plans

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `productId` | string | yes | |
| `name` | string | yes | |
| `interval` | `monthly` \| `yearly` | no | `monthly` |
| `amount` | string | yes | |
| `features` | object<string, boolean\|number> | no | `{}` |
| `seats` | integer ≥ 0 | no | `1` |

```bash
curl -X POST http://localhost:8787/v1/saas/plans \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"productId":"prod_saas...","name":"Team","amount":"99.00","features":{"sso":true,"seats":10},"seats":10}'
```

```json
{ "data": { "id": "plan_2c8e...", "name": "Team", "interval": "monthly", "price": { "amount": "99.00", "currency": "USDC" }, "features": { "sso": true, "seats": 10 }, "seats": 10 } }
```

### GET /v1/saas/plans

With `?productId=` filters to one product.

```bash
curl "http://localhost:8787/v1/saas/plans?productId=prod_saas..." -H "Authorization: Bearer $SK_API_KEY"
```

### POST /v1/saas/features

Grant a feature-bearing tenant entitlement from a plan.

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `organizationId` | string | yes | |
| `customerId` | string | yes | |
| `planId` | string | yes | |
| `grantedById` | string | yes | |
| `grantedByType` | `payment` \| `subscription` \| `bundle` \| `manual` | no | `subscription` |
| `expiresAt` | datetime | no | |

```bash
curl -X POST http://localhost:8787/v1/saas/features \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","customerId":"customer_9a3b...","planId":"plan_2c8e...","grantedById":"sub_6e1a..."}'
```

```json
{ "data": { "id": "tent_4a1c...", "planId": "plan_2c8e...", "features": { "sso": true, "seats": 10 }, "status": "active" } }
```

### POST /v1/saas/entitlements/verify

Check a feature flag/limit on a freshly-built tenant entitlement.

| Field | Type | Required |
|-------|------|----------|
| `planId` | string | yes |
| `organizationId` | string | yes |
| `customerId` | string | yes |
| `grantedById` | string | yes |
| `feature` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/saas/entitlements/verify \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"planId":"plan_2c8e...","organizationId":"org_1","customerId":"customer_9a3b...","grantedById":"sub_6e1a...","feature":"sso"}'
```

```json
{ "data": { "feature": "sso", "enabled": true, "limit": null } }
```

### POST /v1/saas/seats

Assign a seat.

| Field | Type | Required |
|-------|------|----------|
| `customerId` | string | yes |
| `userId` | string | yes |
| `planId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/saas/seats \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"customerId":"customer_9a3b...","userId":"user_42","planId":"plan_2c8e..."}'
```

```json
{ "data": { "seats": [ { "userId": "user_42" } ] } }
```

### POST /v1/saas/seats/remove

Release a seat.

| Field | Type | Required |
|-------|------|----------|
| `customerId` | string | yes |
| `userId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/saas/seats/remove \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"customerId":"customer_9a3b...","userId":"user_42"}'
```

```json
{ "data": { "seats": [] } }
```

---

## GitHub Integration

**Auth required.** Two mounts: `/v1/integrations/github` (installations /
repositories / teams) and `/v1/github/access` (grant / revoke / sync).

### POST /v1/integrations/github/installations

Connect a GitHub App installation.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `installationId` | integer > 0 | yes |
| `accountLogin` | string | yes |
| `accountType` | `User` \| `Organization` | yes |

```bash
curl -X POST http://localhost:8787/v1/integrations/github/installations \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","installationId":12345,"accountLogin":"acme","accountType":"Organization"}'
```

```json
{ "data": { "id": "ghi_2a4c...", "installationId": 12345, "accountLogin": "acme", "accountType": "Organization" } }
```

### GET /v1/integrations/github/installations

With `?organizationId=` filters to one org.

```bash
curl "http://localhost:8787/v1/integrations/github/installations?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

### GET /v1/integrations/github/repositories

Repositories visible to installations (derived from recorded grants).

```bash
curl http://localhost:8787/v1/integrations/github/repositories -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "owner": "acme", "name": "private-repo", "fullName": "acme/private-repo" } ] }
```

### GET /v1/integrations/github/teams

Org teams synthesized from organization installations. With `?organizationId=`
filters.

```bash
curl "http://localhost:8787/v1/integrations/github/teams?organizationId=org_1" -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "orgLogin": "acme", "slug": "members", "name": "acme/members" } ] }
```

### POST /v1/github/access/grant

Grant a customer access to a private repo.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `installationId` | integer > 0 | yes |
| `customerId` | string | yes |
| `entitlementId` | string | yes |
| `repoOwner` | string | yes |
| `repoName` | string | yes |
| `githubUsername` | string | yes |
| `permission` | `pull` \| `push` \| `maintain` | no |

```bash
curl -X POST http://localhost:8787/v1/github/access/grant \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"org_1","installationId":12345,
    "customerId":"customer_9a3b...","entitlementId":"ent_77aa...",
    "repoOwner":"acme","repoName":"private-repo","githubUsername":"octocat","permission":"push"
  }'
```

```json
{ "data": { "id": "ghg_8b1d...", "repoOwner": "acme", "repoName": "private-repo", "githubUsername": "octocat", "permission": "push", "status": "invited" } }
```

### POST /v1/github/access/revoke

| Field | Type | Required |
|-------|------|----------|
| `grantId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/github/access/revoke \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"grantId":"ghg_8b1d..."}'
```

```json
{ "data": { "id": "ghg_8b1d...", "status": "revoked" } }
```

### POST /v1/github/access/sync

Reconcile recorded grants: promote pending (`invited`) grants the GitHub client
now reports as accepted.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/github/access/sync \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1"}'
```

```json
{ "data": { "organizationId": "org_1", "outcomes": [ { "grantId": "ghg_8b1d...", "action": "activated" } ] } }
```

---

## Discord Integration

**Auth required.** Two mounts: `/v1/integrations/discord` (connect / guilds /
roles) and `/v1/discord/access` (grant / revoke).

### POST /v1/integrations/discord/connect

Connect a guild.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `guildId` | string | yes |
| `guildName` | string | yes |
| `botTokenRef` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/integrations/discord/connect \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"organizationId":"org_1","guildId":"99887766","guildName":"Acme Community","botTokenRef":"secret://discord-bot"}'
```

```json
{ "data": { "id": "dcon_3f9a...", "guildId": "99887766", "guildName": "Acme Community" } }
```

### GET /v1/integrations/discord/guilds

List guilds the bot is in.

```bash
curl http://localhost:8787/v1/integrations/discord/guilds -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "99887766", "name": "Acme Community" } ] }
```

### GET /v1/integrations/discord/roles

List assignable roles for a guild. Query param `guildId` is **required**.

```bash
curl "http://localhost:8787/v1/integrations/discord/roles?guildId=99887766" -H "Authorization: Bearer $SK_API_KEY"
```

```json
{ "data": [ { "id": "role_paid", "name": "Supporter", "guildId": "99887766" } ] }
```

### POST /v1/discord/access/grant

Grant a paid role.

| Field | Type | Required |
|-------|------|----------|
| `organizationId` | string | yes |
| `guildId` | string | yes |
| `roleId` | string | yes |
| `customerId` | string | yes |
| `entitlementId` | string | yes |
| `discordUserId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/discord/access/grant \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{
    "organizationId":"org_1","guildId":"99887766","roleId":"role_paid",
    "customerId":"customer_9a3b...","entitlementId":"ent_77aa...","discordUserId":"557799"
  }'
```

```json
{ "data": { "id": "dgr_6a2c...", "guildId": "99887766", "roleId": "role_paid", "discordUserId": "557799", "status": "active" } }
```

### POST /v1/discord/access/revoke

| Field | Type | Required |
|-------|------|----------|
| `grantId` | string | yes |

```bash
curl -X POST http://localhost:8787/v1/discord/access/revoke \
  -H "Authorization: Bearer $SK_API_KEY" -H "Content-Type: application/json" \
  -d '{"grantId":"dgr_6a2c..."}'
```

```json
{ "data": { "id": "dgr_6a2c...", "status": "revoked" } }
```

---

## x402 Paid Endpoints

`/v1/paid/*` — **Public** (no API key). The USDC payment itself is the
authorization, so both humans and AI agents pay per call. The endpoint returns
`402 Payment Required` with a `PaymentRequirements` document until a valid
`X-Payment` proof is presented and verified on-chain.

On-chain settlement requires Arc configured via `ARC_RPC_URL`. Without it, the
402 challenge is still fully functional and any presented proof is honestly
rejected (no mock acceptance). Each settled call is metered as one `paid_calls`
unit attributed to the payer.

### GET /v1/paid/research

A demo pay-per-call endpoint priced at `0.005 USDC` on the `arc` network.

**Step 1 — request without payment → 402 challenge:**

```bash
curl -i http://localhost:8787/v1/paid/research
```

Response (`402`), with the requirements echoed in both the body and the
`X-Payment-Required` (and `Accept-Payment`) headers:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
X-Payment-Required: {"scheme":"x402","amount":"0.005","asset":"USDC","network":"arc","payTo":"0x...","productId":"prod_x402_research","resource":"http://localhost:8787/v1/paid/research","nonce":"a1b2c3d4..."}
```

```json
{
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "x402",
      "amount": "0.005",
      "asset": "USDC",
      "network": "arc",
      "payTo": "0x0000000000000000000000000000000000000000",
      "productId": "prod_x402_research",
      "resource": "http://localhost:8787/v1/paid/research",
      "nonce": "a1b2c3d4..."
    }
  ]
}
```

**Step 2 — pay on-chain, then retry with the `X-Payment` proof.** The proof is
base64-encoded JSON of:

```json
{
  "txHash": "0xpaidtx...",
  "from": "0xPayerWallet",
  "amount": "0.005",
  "network": "arc",
  "nonce": "a1b2c3d4..."
}
```

The `nonce` MUST echo the one from the 402 challenge to bind the payment to this
request. Construct the header value as `base64(JSON.stringify(proof))`:

```bash
PROOF='{"txHash":"0xpaidtx...","from":"0xPayerWallet","amount":"0.005","network":"arc","nonce":"a1b2c3d4..."}'
XPAY=$(printf '%s' "$PROOF" | base64)

curl -i http://localhost:8787/v1/paid/research \
  -H "X-Payment: $XPAY"
```

On successful on-chain verification (`200`):

```json
{
  "data": {
    "answer": "Paid research result: USDC settles on Arc in seconds.",
    "generatedAt": "2026-06-16T12:00:00.000Z"
  }
}
```

If the proof is malformed, the nonce/amount/payTo do not match the challenge, or
Arc is not configured, the endpoint again responds `402` with a `reason` field
explaining the rejection, e.g.:

```json
{
  "error": "payment_required",
  "accepts": [ { "scheme": "x402", "amount": "0.005", "asset": "USDC", "network": "arc", "payTo": "0x...", "productId": "prod_x402_research", "resource": "http://localhost:8787/v1/paid/research", "nonce": "a1b2c3d4..." } ],
  "reason": "x402 settlement requires Arc (set ARC_RPC_URL)"
}
```
