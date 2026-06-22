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

## Demo

<p align="center">
  <a href="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.mp4">
    <img src="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.gif" alt="SettleKit product walkthrough" width="900">
  </a>
</p>

<p align="center">
  <a href="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.mp4"><b>▶ Watch the full-quality video (MP4)</b></a>
</p>

---

## Live deployment

SettleKit is live — API on Render, frontends on Vercel:

| Surface | URL |
| --- | --- |
| Marketing site | https://settlekit-web.vercel.app |
| Merchant dashboard | https://dashboard-neon-beta-80.vercel.app |
| Marketplace | https://settlekit-marketplace.vercel.app |
| Checkout | https://settlekit-checkout.vercel.app |
| Docs | https://settlekit-docs.vercel.app |
| API | https://settlekit-zym1.onrender.com |

> The API runs on Render's free tier and sleeps when idle, so the first request
> after a pause can take ~60s to wake. Frontends read the API URL from
> `NEXT_PUBLIC_API_URL`. Full setup in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

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
│   ├── creator-dashboard/ Creator earnings + attribution view (Next.js 14, Lepton)
│   ├── checkout/     Hosted USDC checkout (Next.js 14)
│   ├── marketplace/  Public marketplace (Next.js 14)
│   ├── admin/        Internal admin + risk console (Next.js 14)
│   ├── docs/         Developer documentation site (Next.js 14)
│   ├── cli/          Official `settlekit` CLI (commander) — manage everything
│   └── examples/     Runnable usage examples
├── sdks/
│   ├── node/         (packages/sdk) TypeScript/Node SDK
│   ├── python/       Python SDK — client + verify + x402 paid-API middleware
│   ├── go/           Go SDK
│   └── rust/         Rust SDK
├── clis/
│   └── agentpay/     Go CLI for AI-agent commerce (x402 discover → pay → call)
├── services/
│   ├── arc-indexer/      (Rust) Arc USDC settlement indexer
│   ├── x402-gateway/     (Go) x402 paid-API gateway
│   └── license-gateway/  (Rust) caching license/api-key/entitlement verifier
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
    ├── arc-chains/   Arc/Circle chain · token · contract constants (one source of truth)
    ├── app-kit/      Circle App Kit on Arc — Send/Bridge/Swap/Unified Balance + settlement bridge
    ├── erc8004/      ERC-8004 agent identity · reputation · validation on Arc
    ├── erc8183/      ERC-8183 autonomous-agent job lifecycle (escrow create→settle)
    ├── circle/       Circle Gateway / x402 payment rails
    ├── circle-wallets/ Circle Developer-Controlled Wallets (transfers + contract execution)
    ├── x402/         x402 paid-API middleware
    ├── database/     drizzle schema, migrations, doc codec
    ├── persistence/  Shared Postgres stores (used by api · worker · checkout)
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
| Marketplace | `pnpm --filter @settlekit/marketplace dev` | `3011` | http://localhost:3011 |
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

**Persistence.** Set `DATABASE_URL` and every app — API, worker, and the hosted
checkout — runs on real PostgreSQL through the shared `@settlekit/persistence`
layer, reading and writing one database. Leave it unset and the same code runs
on an in-process store with zero infrastructure (local dev / tests). Confirming
a payment verifies the USDC transfer **on-chain** (against the session's `payTo`
address and required confirmations) before access is granted whenever Arc is
configured. Apply migrations with `make db-migrate` (or
`pnpm --filter @settlekit/database db:migrate`).

For the full model — universal entitlements, the delivery action flow, the
persistence/dual-backend design, package layering, and the data model — read
[ARCHITECTURE.md](./ARCHITECTURE.md).

---

## SDKs, CLIs & services

SettleKit ships first-party clients and edge services in four languages, all
speaking the same `/v1` API:

| Component | Language | Path | What it does |
| --- | --- | --- | --- |
| Node SDK | TypeScript | `packages/sdk` | Typed client for every resource |
| Python SDK | Python | `sdks/python` | Client + `verify_*` helpers + x402 `require_payment` middleware |
| Go SDK | Go | `sdks/go` | Typed Go client |
| Rust SDK | Rust | `sdks/rust` | Typed Rust client |
| React SDK | TypeScript | `packages/react` | `<Paywall>`, `useEntitlement`, checkout hooks |
| **CLI** | TypeScript | `apps/cli` | `settlekit` — manage products, checkout, license keys, coupons, invoices, marketplace, usage, payouts from the terminal |
| **agentpay** | Go | `clis/agentpay` | AI-agent commerce CLI: discover services → pay per call via x402 |
| arc-indexer | Rust | `services/arc-indexer` | Indexes Arc USDC settlements |
| x402-gateway | Go | `services/x402-gateway` | Fronts paid APIs with x402 challenge/verify |
| license-gateway | Rust | `services/license-gateway` | Sub-ms cached verification of license keys / API keys / entitlements |

```bash
# CLI
pnpm --filter @settlekit/cli build && node apps/cli/dist/index.js products list
# Python SDK
pip install -e sdks/python
# Go agent CLI / Rust gateway
( cd clis/agentpay && go build ./... )
( cd services/license-gateway && cargo run --release )
```

## Documentation

| Doc | What's inside |
| --- | --- |
| [docs/QUICKSTART.md](./docs/QUICKSTART.md) | Zero-to-sale walkthrough: product → checkout → payment → delivery → usage billing (curl + CLI) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Universal entitlements, delivery flow, persistence/dual-backend, package layering, data model |
| [PRODUCTION.md](./PRODUCTION.md) | Production topology, deployment, migrations, security hardening, scaling, observability, go-live checklist |
| [docs/API.md](./docs/API.md) | Complete REST reference for every `/v1` endpoint (curl + responses) + the x402 paid-API flow |
| [docs/CONFIGURATION.md](./docs/CONFIGURATION.md) | Every environment variable, per component (API, worker, services, SDKs/CLIs) |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Repo conventions and how to add a package or app |

Per-component docs live next to their code: every SDK (`packages/sdk`, `sdks/python`, `sdks/go`, `sdks/rust`), CLI (`apps/cli`, `clis/agentpay`), service (`services/*`), and example (`examples/*`) ships its own `README.md`.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add a package or app and the
repo conventions (ESM `.js` import suffixes, immutability, the
`@settlekit/common` contract).

## License

Open source — self-host or use the hosted cloud.

