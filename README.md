# SettleKit

> **SettleKit lets developers sell private repos, SaaS, APIs, templates, and AI tools in USDC — and automatically delivers access after payment.**

SettleKit is an open-source Commerce OS for software. Connect GitHub, create a
product, set a USDC price, and share your checkout link. SettleKit handles
payment verification, **access delivery**, subscriptions, license keys,
webhooks, and customer portals.

Sell private GitHub repos, SaaS subscriptions, API access, AI agent tools,
templates, datasets, license keys, and digital downloads — settled in USDC on
Arc, with automatic access delivery the moment a payment confirms.

```text
Create product → Set price → Buyer pays → Access delivered
```

---

## Why SettleKit

Everything becomes an **entitlement**:

```text
Payment gives entitlement.
Entitlement gives access.
Access can be GitHub, SaaS, API, file, Discord, license, package, or agent tool.
```

One purchase can fan out into many delivery actions — grant a GitHub repo, issue
a license key, add a Discord role, create a SaaS entitlement, send a webhook, and
email the buyer — all driven by the **entitlements engine** and the **delivery
runner**. These two are the core of the system; see
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Monorepo layout

This is a pnpm + TypeScript project-references monorepo.

```text
settlekit/
├── apps/
│   ├── api/          HTTP API (Hono on Node) — /v1 resources
│   ├── worker/       Background worker — delivery, confirmation, sweeps, retries
│   ├── dashboard/    Merchant dashboard (Next.js 14)
│   ├── checkout/     Hosted USDC checkout (Next.js 14)
│   ├── marketplace/  Public marketplace (Next.js 14)
│   ├── admin/        Internal admin + risk console (Next.js 14)
│   ├── docs/         Developer documentation site (Next.js 14)
│   └── examples/     Runnable usage examples
└── packages/
    ├── common/       Domain types, Result/ok/err, SettleKitError, money(), generateId
    ├── entitlements/ Universal entitlement model (core)
    ├── delivery/     Delivery action engine / runner (core)
    ├── payments/     Payment + confirmation
    ├── product-catalog/ Products, prices
    ├── bundles/      Multi-product bundles
    ├── license-keys/ License key issuance
    ├── api-keys/     API key issuance
    ├── file-delivery/ Digital downloads / signed access
    ├── github/       GitHub repo + team access
    ├── discord/      Discord role access
    ├── saas/         SaaS plans, features, seats
    ├── webhooks/     Webhook endpoints + signed delivery
    ├── notifications/ Transactional email
    ├── agent-services/ AI agent service listings
    ├── escrow/       Escrow tasks
    ├── arc/          Arc settlement + USDC chain reads
    ├── circle/       Circle Gateway / x402 payment rails
    ├── x402/         x402 paid-API middleware
    ├── database/     Repositories + schema
    └── …             plus billing, usage, payouts, risk, and more
```

Packages are wired through TypeScript project references; apps depend on packages
via `workspace:*`.

---

## Prerequisites

- **Node.js 20+** (`node --version`)
- **pnpm 11** — enable via Corepack: `corepack enable && corepack prepare pnpm@11.3.0 --activate`
- **Docker** (optional) — for `docker compose` and the bundled Postgres
- A **PostgreSQL 16** database if running outside Docker

---

## Install, build, and develop

```bash
# Install all workspace dependencies
pnpm install

# Build every package + app (tsc project references)
pnpm build

# Typecheck the whole repo without emitting
pnpm typecheck

# Clean build output
pnpm clean
```

`pnpm build` runs `pnpm -r build`, which compiles each package and app in
dependency order.

---

## Running each app

Copy the env template first:

```bash
cp .env.example .env
```

| App         | Command                  | Default port | URL                     |
| ----------- | ------------------------ | ------------ | ----------------------- |
| API         | `pnpm --filter @settlekit/api dev`         | `8787` | http://localhost:8787 |
| Worker      | `pnpm --filter @settlekit/worker dev`      | —      | (no HTTP port)        |
| Dashboard   | `pnpm --filter @settlekit/dashboard dev`   | `3001` | http://localhost:3001 |
| Marketplace | `pnpm --filter @settlekit/marketplace dev` | `3002` | http://localhost:3002 |
| Checkout    | `pnpm --filter @settlekit/checkout-app dev`| `3003` | http://localhost:3003 |
| Admin       | `pnpm --filter @settlekit/admin dev`       | `3004` | http://localhost:3004 |
| Docs        | `pnpm --filter @settlekit/docs-app dev`    | `3005` | http://localhost:3005 |

> The API reads `PORT` (default `8787`). Next apps read `PORT` when started via
> `next start -p $PORT`. The Docker images and `docker-compose.yml` assign the
> host ports in the table above; the `Makefile` and `docker compose` keep these
> in sync.

Convenience targets are available via the [Makefile](./Makefile):

```bash
make install      # pnpm install
make build        # pnpm -r build
make dev-api      # run the API
make dev-worker   # run the worker
make dev-dashboard
make db-up        # start Postgres in Docker
make db-migrate   # apply database migrations
make up           # docker compose up (full stack)
make down         # docker compose down
```

---

## Environment variables

Every variable the system reads is documented in
[.env.example](./.env.example). Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `ARC_RPC_URL` / `ARC_CHAIN_ID` / `ARC_USDC_ADDRESS` | Arc chain settlement + USDC reads |
| `CIRCLE_API_KEY` | Circle Gateway / x402 payment rails |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` | GitHub repo + team access delivery |
| `DISCORD_BOT_TOKEN` | Discord role grants |
| `RESEND_API_KEY` / `EMAIL_FROM` | Transactional email |
| `S3_*` / `R2_*` | File asset storage for digital downloads |
| `WEBHOOK_SIGNING_SECRET` | Signs outbound webhooks |
| `NEXT_PUBLIC_API_URL` | API base URL for the Next apps |
| `PORT` | Listen port for the API / Next apps |

Validate that required secrets are present at startup; never commit a real
`.env`.

---

## Architecture overview

The two core subsystems:

1. **Entitlements engine** (`@settlekit/entitlements`) — the universal access
   model. Every paid resource (GitHub repo, SaaS feature, API credits, license,
   file, Discord role, agent tool) is represented as an `Entitlement`. Access
   checks across the whole platform resolve to entitlements.

2. **Delivery runner** (`@settlekit/delivery`) — the action engine that executes
   after a payment confirms. A `DeliveryRun` expands a product's
   `DeliveryAction`s into ordered steps (grant GitHub, issue license, add Discord
   role, create SaaS entitlement, send webhook, send email), with retry and
   status tracking.

The HTTP API (`apps/api`) exposes `/v1` resources backed by the domain packages
and returns a consistent `{ data }` / `{ error }` envelope. The worker
(`apps/worker`) confirms payments on Arc, runs deliveries, syncs access, sweeps
renewals, and retries webhooks.

For the full model — universal entitlements, the delivery action flow, package
layering, and the data model — read [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a package or app and the
repo conventions (ESM `.js` import suffixes, immutability, the
`@settlekit/common` contract).

## License

Open source — self-host or use the hosted cloud.
