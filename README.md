# SettleKit

> **Get paid in stablecoins on any chain, by people or AI agents, and deliver access automatically.**

SettleKit is an open-source payment link and checkout for software sellers:
founders, small teams, app studios, and API or tool builders. Create a product,
set a USD price, share one link. Buyers pay on the chain they already use;
SettleKit verifies the transfer on-chain, fail closed, and delivers access the
moment it confirms: GitHub repo invites, license keys, API keys, Discord roles,
SaaS plans, files, and signed webhooks to your backend.

| Network | Asset | Label |
| --- | --- | --- |
| Solana | USDC | Solana Pay + x402 agent payments |
| Ethereum, Base, Arbitrum | USDC | wallet checkout + x402 agent payments |
| Hyperliquid | USDC on HyperEVM, or `usdSend` to HyperCore | two separate balances |
| Robinhood Chain | USDG (Paxos) | no native USDC on mainnet |
| Tempo | USDC.e | bridged; MPP agent payments |
| Zcash | ZEC at a locked USD quote | transparent only, mainnet only |

- **Pay with any token** from another chain (Relay, LI.FI fallback); access is granted only after the destination transfer is verified.
- **AI agents buy directly** over x402 v2 (Solana, EVM chains) and MPP (Tempo) and get the product in the response.
- **Onchain subscriptions** (Permit2, Base spend permissions and commerce-payments escrow, SPL delegate, renewal invoices) and **refunds that send funds**.
- **Public proof**: every confirmed payment is listed at `/proof` with explorer links, mainnet and testnet kept apart.
- **1% per payment**, no fixed or monthly fee (`DEFAULT_FEE_SCHEDULE` in `packages/platform-billing`). Open source and self-hostable.

```text
Create product -> Share link -> Buyer pays on any chain (or an agent pays) -> Verified on-chain -> Access delivered
```

### Colosseum Crypto World's Fair

SettleKit is entered in the Colosseum Crypto World's Fair (Sep 14 to Oct 12, 2026).
Work done in the window is `git diff pre-colosseum-baseline..HEAD` on
`feat/solana-colosseum`; everything up to tag `pre-colosseum-baseline`
(`7c6f6ce`, 2026-06-22) pre-exists and is disclosed.

| Doc | What's inside |
| --- | --- |
| [docs/colosseum/SUBMISSION.md](./docs/colosseum/SUBMISSION.md) | Problem, solution, chain matrix with honest labels, architecture, OSS composed, security model, business model, GTM, traction template, disclosure with in-window stats |
| [docs/colosseum/PITCH-SCRIPT.md](./docs/colosseum/PITCH-SCRIPT.md) | 2 to 3 minute pitch video script |
| [docs/colosseum/DEMO-SCRIPT.md](./docs/colosseum/DEMO-SCRIPT.md) | Demo video click path and required setup |
| [docs/colosseum/LAUNCH-CHECKLIST.md](./docs/colosseum/LAUNCH-CHECKLIST.md) | Owner steps to go live: Render, env, keys, first mainnet payment per chain |

### SettleKit Operator (Arc)

An autonomous business operator on Arc, built for the Tameion Agents Hackathon
(Canteen x Circle). Checkout revenue lands in an on-chain `OperatorVault`
(`contracts/src/OperatorVault.sol`), and a Claude agent allocates it, pays
vendors and handles refunds within on-chain caps. Anything outside those caps
is escalated to the owner, and every decision is hash-chained and anchored on
Arc. The code lives in `packages/operator`, `apps/operator-console`,
`/v1/operator/*` in `apps/api`, and the worker's operator tick. It is a no-op
unless `OPERATOR_VAULT_ADDRESS` or `OPERATOR_SIMULATION=1` is set.

See [TAMEION.md](./TAMEION.md) for the pitch, architecture, run guide and
disclosure, and [docs/tameion/](./docs/tameion/) for the plan.

---

## Demo (pre-hackathon, Arc USDC)

<p align="center">
  <a href="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.mp4">
    <img src="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.gif" alt="SettleKit product walkthrough" width="900">
  </a>
</p>

<p align="center">
  <a href="https://github.com/caelum0x/settlekit/releases/download/demo-2026-06-22/settlekit-demo.mp4"><b>▶ Watch the full-quality video (MP4)</b></a>
</p>

---

## Hackathon demos (October 2026)

| Video | Length | For |
| --- | --- | --- |
| [settlekit-colosseum.mp4](https://github.com/caelum0x/settlekit/releases/download/hackathon-2026-10/settlekit-colosseum.mp4) | 2:18 | Colosseum Crypto World's Fair (Solana checkout, x402 agent payments) |
| [settlekit-tameion.mp4](https://github.com/caelum0x/settlekit/releases/download/hackathon-2026-10/settlekit-tameion.mp4) | 2:22 | Tameion Agents Hackathon (Arc operator, OperatorVault) |

Both were recorded on 2026-10-07 against the live deployment below, in testnet mode.

---

## Live deployment

SettleKit runs on Render's free plan in **testnet mode**. Every service auto-deploys from `main`:

| Surface | URL |
| --- | --- |
| Marketing site, public proof, integration docs | https://settlekit-web.onrender.com (`/proof`, `/docs/integrate`) |
| API | https://settlekit-api.onrender.com (`/health`) |
| Checkout (demo $1 link) | https://settlekit-checkout.onrender.com/l/pro-templates-demo-417bacd7 |
| Merchant dashboard | https://settlekit-dashboard.onrender.com |
| Operator console (Arc) | https://settlekit-operator.onrender.com/proof |

> Free instances sleep when idle, so the first request after a pause takes
> about 40 to 80 seconds. The demo checkout accepts Solana devnet USDC and
> Base, Arbitrum and Ethereum testnet USDC. The operator console shows
> "operator not configured" until a vault is attached (see
> [TAMEION.md](./TAMEION.md)). Full setup is in [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

### Status and traction (as of 2026-10-07)

These are the real numbers, so the hackathon submissions use them too.

| | |
| --- | --- |
| Tests | 2,152 vitest passing (3 skipped); 48 Foundry tests, 21 of them on `OperatorVault`; 181 operator-stack tests |
| Solana | A live checkout session returns a devnet Solana Pay URL with a server-built transaction |
| Arc | `OperatorVault` deploys and its caps and allowlist apply on an Arc testnet fork; the full USDC path runs on Arc testnet itself |
| Users and revenue | 0 mainnet payments, 0 external users, no revenue yet |
| Repo | 0 stars, 261 clones in the last 14 days |

### Arc mainnet (chain 5042)

`contracts/script/deploy-arc-mainnet.sh` deploys `OperatorVault` and
`SettleKitEscrow` to Arc mainnet and verifies them on Sourcify and Blockscout
in one command. It is not deployed yet. The expected cost is about 0.06 USDC.

```bash
cast wallet import settlekit-deployer --interactive   # once; fund it with ~1 USDC on Arc
contracts/script/deploy-arc-mainnet.sh --account settlekit-deployer
```

`SettleKitCctpHook` must **not** be deployed to mainnet: under CCTP V2, funds
minted to it would be stuck. See [docs/tameion/MAINNET-BOUNTY.md](./docs/tameion/MAINNET-BOUNTY.md).

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

### Chain support

Checkout, API and worker share one registry (`@settlekit/chains`) and fail
closed per network. Full matrix with finality notes:
[apps/checkout/README.md](./apps/checkout/README.md#chain-support).

| Network | Asset | Environments | Label |
| --- | --- | --- | --- |
| Solana | USDC | mainnet, devnet | |
| Base, Ethereum, Arbitrum, HyperEVM | USDC | mainnet, testnet | |
| Robinhood Chain | USDG (mainnet), Mock USDC (testnet) | mainnet, testnet | no native USDC |
| Tempo | USDC.e (mainnet), pathUSD (testnet) | mainnet, testnet | bridged |
| Arc | USDC | testnet only | testnet |
| Zcash | ZEC at a locked USD quote | mainnet only | transparent, not shielded |

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

