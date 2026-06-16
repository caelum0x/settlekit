# SettleKit Production Guide

The authoritative production deployment and readiness guide for SettleKit — the
open-source USDC Commerce OS. This document covers the production topology, the
toolchains and secrets you must provision, how to build and run every deployable,
and the security, scaling, and observability practices that keep a settlement
system healthy.

For the system model (universal entitlements, the delivery runner, the
dual-backend persistence design) read [ARCHITECTURE.md](./ARCHITECTURE.md). For
the full endpoint list, read `apps/api/src/app.ts` and `apps/api/src/routes/*.ts`.
Every environment variable is documented in [.env.example](./.env.example).

---

## 1. Production topology

SettleKit deploys as **two Node deployables** (API + worker), **four edge
services** (two Rust, two Go/Rust), **five Next.js apps**, and a single shared
**PostgreSQL 16** database. PostgreSQL is the only shared state: every stateful
component reads and writes the same database through `@settlekit/persistence`.

```text
                                  ┌────────────────────────────┐
       Browsers / merchants       │   Next.js apps (stateless) │
       buyers / admins ──────────▶│  dashboard   :3001         │
                                  │  marketplace :3002         │   server-side calls
                                  │  checkout    :3003 ────────┼──┐  use NEXT_PUBLIC_API_URL
                                  │  admin       :3004         │  │
                                  │  docs        :3005         │  │
                                  └────────────────────────────┘  │
                                                                  ▼
   AI agents / SDK clients ─────────────────────▶ ┌──────────────────────────┐
   (node/python/go/rust, CLI, agentpay)           │   API  (Hono /v1) :8787   │
                                                   │   stateless, scale N×     │
   x402 pay-per-call (public /v1/paid/*) ─────────▶│   GET /health             │
                                                   └────────────┬──────────────┘
                                                                │ @settlekit/persistence
                                                                ▼
                            ┌──────────────────────────────────────────────────────┐
                            │            PostgreSQL 16  (shared state)               │
                            │  products · payments · entitlements · delivery_runs ·  │
                            │  worker_* queues · auth_* · escrow_* · coupons …       │
                            └──────────────────────────────────────────────────────┘
                                                                ▲
                                                                │ @settlekit/persistence
                                                   ┌────────────┴──────────────┐
   Arc / EVM chain (USDC) ◀───reads───────────────▶│  Worker (no HTTP port)    │
                                                   │  9 scheduled jobs:         │
                                                   │  confirm · deliver · sync ·│
                                                   │  renew · webhook-retry ·   │
                                                   │  receipt/renewal/dunning/  │
                                                   │  access emails             │
                                                   └────────────────────────────┘

   Edge services (independent processes; talk to the API or the chain, NOT to Postgres):

   ┌─────────────────────┐   POST /v1/payments/{txHash}/confirm    ┌────────────┐
   │ arc-indexer  (Rust) │ ───── Bearer API key ──────────────────▶│            │
   │ watches USDC chain  │ ◀──── reads ARC_RPC_URL ─────  Arc chain │            │
   └─────────────────────┘                                         │            │
   ┌─────────────────────┐   POST /v1/{license,api-keys,           │  API :8787 │
   │ license-gateway     │   entitlements}/verify  (cached TTL)    │            │
   │ (Rust)      :8090   │ ───── Bearer API key ──────────────────▶│            │
   └─────────────────────┘                                         └────────────┘
   ┌─────────────────────┐   optional VERIFY_URL ──▶ API (or local stateless verify)
   │ x402-gateway (Go)   │   reverse-proxies paid traffic to your protected upstream
   │             :8402   │
   └─────────────────────┘
   ┌─────────────────────┐   fans out SettleKit webhook events to subscriber URLs
   │ webhook-relay(Rust) │   HMAC-signs each delivery (v1=<hmac-sha256>)
   │             :8091   │
   └─────────────────────┘
```

**Who talks to Postgres:** only `api`, `worker`, and `checkout` (server-side)
import `@settlekit/persistence` and connect to the database. The other Next apps
(`dashboard`, `marketplace`, `admin`, `docs`) call the API over HTTP via
`NEXT_PUBLIC_API_URL`. The four edge services never touch Postgres directly —
they talk to the API or the chain.

| Component | Lang | HTTP port | Talks to Postgres | Reads the chain | Health |
| --- | --- | --- | --- | --- | --- |
| api | TS (Hono/Node) | 8787 | yes | yes (confirm) | `GET /health` |
| worker | TS (Node) | — | yes | yes | process logs |
| dashboard | Next.js | 3001 | no (calls API) | no | — |
| marketplace | Next.js | 3002 | no (calls API) | no | — |
| checkout | Next.js | 3003 | yes (server-side) | yes (confirm) | — |
| admin | Next.js | 3004 | no (calls API) | no | — |
| docs | Next.js | 3005 | no | no | — |
| arc-indexer | Rust | — | no (→ API) | yes | — |
| x402-gateway | Go | 8402 | no | no | `GET /healthz` |
| license-gateway | Rust | 8090 | no (→ API) | no | `GET /healthz` |
| webhook-relay | Rust | 8091 | no | no | `GET /healthz` |

---

## 2. Prerequisites & provisioning

| Tool | Version | Install / verify |
| --- | --- | --- |
| Node.js | 20+ (`engines.node >=20`) | `node --version` |
| pnpm | 11.3.0 (`packageManager`) | `corepack enable && corepack prepare pnpm@11.3.0 --activate` |
| PostgreSQL | 16 | managed (RDS/Cloud SQL/Neon) or `postgres:16-alpine` |
| Rust toolchain | stable (1.75+) | `rustup default stable` — for arc-indexer, license-gateway, webhook-relay |
| Go toolchain | 1.21+ | `go version` — for x402-gateway and the agentpay CLI |
| Docker (optional) | recent | `docker compose version` — for the bundled stack |

The Node deployables and Next apps build from the monorepo root:

```bash
corepack enable && corepack prepare pnpm@11.3.0 --activate
pnpm install            # install the full workspace (frozen in CI: --frozen-lockfile)
pnpm build              # tsc -b across packages + apps in dependency order
pnpm typecheck          # whole-repo typecheck, no emit
```

The Rust/Go services build independently from their own directories (see §4).

---

## 3. Database

### Dual-backend behavior

The backend is selected at boot by `DATABASE_URL`:

```text
DATABASE_URL set    → real PostgreSQL via @settlekit/persistence (drizzle-orm)
DATABASE_URL unset  → in-process in-memory stores (local dev / tests only)
```

**In production you MUST set `DATABASE_URL`.** Without it the API and worker run
on per-process in-memory stores and lose all state on restart — never run that in
production. Each table stores the full canonical entity under `metadata.__doc`
(document-projection), with a few typed columns projected alongside for indexing.

### Applying migrations

Migrations live in `packages/database/drizzle` (`0000_init.sql` …
`0005_worker_persistence.sql`) and are applied with drizzle-kit. Build the
package first (drizzle-kit reads compiled JS schema), then migrate:

```bash
pnpm --filter @settlekit/database build
DATABASE_URL=postgres://user:pass@host:5432/settlekit \
  pnpm --filter @settlekit/database db:migrate
# or, equivalently, via the Makefile:
make db-migrate
```

`db:migrate` runs `drizzle-kit migrate`, which applies every pending migration in
order and is safe to run repeatedly (already-applied migrations are skipped). The
default organization and merchant are seeded **idempotently on boot** by the API
and worker, so no manual seed step is required.

### Provisioning order

1. Create the database and role.
2. Set `DATABASE_URL`.
3. Run migrations (`make db-migrate`).
4. Start the API, then the worker.

### Backups

PostgreSQL is the single source of truth — back it up like any production
database:

```bash
# Logical backup (point-in-time-friendly with --format=custom)
pg_dump --format=custom --no-owner "$DATABASE_URL" > settlekit-$(date +%F).dump

# Restore
pg_restore --no-owner --dbname "$DATABASE_URL" settlekit-2026-06-16.dump
```

Use a managed Postgres with PITR/WAL archiving where possible. Because the full
entity lives in `metadata.__doc`, restores are lossless regardless of subsequent
schema additions.

---

## 4. Build & run every deployable

### Node deployables (Docker)

The repo ships production Dockerfiles. **Build from the monorepo root.**

**API** — `apps/api/Dockerfile`, runs `node dist/server.js`, listens on `PORT`
(default 8787), exposes `GET /health`:

```bash
docker build -f apps/api/Dockerfile -t settlekit-api .
docker run --rm -p 8787:8787 --env-file .env settlekit-api
# health: curl -s http://localhost:8787/health  ->  {"data":{"status":"ok","service":"settlekit-api"}}
```

**Worker** — `apps/worker/Dockerfile`, runs `node ./dist/index.js`, no HTTP port.
On boot it constructs real GitHub/Discord/Arc/Resend transports, ensures the
default org/merchant exist, and starts 9 scheduled jobs:

```bash
docker build -f apps/worker/Dockerfile -t settlekit-worker .
docker run --rm --env-file .env settlekit-worker
```

**Next.js apps** — all five share `Dockerfile.next`, parameterised by build args.
Each runs `next start -p $PORT`:

```bash
# dashboard (3001) — repeat with the matching args per app
docker build -f Dockerfile.next \
  --build-arg APP_DIR=dashboard \
  --build-arg APP_PKG=@settlekit/dashboard \
  --build-arg APP_PORT=3001 -t settlekit-dashboard .
docker run --rm -p 3001:3001 --env-file .env settlekit-dashboard
```

| App | APP_DIR | APP_PKG | APP_PORT |
| --- | --- | --- | --- |
| dashboard | `dashboard` | `@settlekit/dashboard` | 3001 |
| marketplace | `marketplace` | `@settlekit/marketplace` | 3002 |
| checkout | `checkout` | `@settlekit/checkout-app` | 3003 |
| admin | `admin` | `@settlekit/admin` | 3004 |
| docs | `docs` | `@settlekit/docs-app` | 3005 |

### Full stack via docker compose

`docker-compose.yml` brings up Postgres (with a healthcheck), the API, the
worker, and all five Next apps, wired on a shared `.env`:

```bash
cp .env.example .env          # then fill in real secrets
docker compose up --build     # or: make up
# stop: docker compose down    (make down)
```

The API and worker depend on Postgres being healthy; the Next apps depend on the
API. Run migrations once the database is up (`make db-migrate`).

### Running without Docker (pnpm)

```bash
pnpm build
pnpm --filter @settlekit/api start            # node apps/api/dist/server.js — port 8787
pnpm --filter @settlekit/worker start         # node apps/worker/dist/index.js
pnpm --filter @settlekit/dashboard start      # next start -p 3001
# checkout uses the package name @settlekit/checkout-app; docs uses @settlekit/docs-app
```

The official CLI is a Node binary built from `apps/cli`:

```bash
pnpm --filter @settlekit/cli build
SETTLEKIT_API_URL=https://api.example.com SETTLEKIT_API_KEY=sk_live_… \
  node apps/cli/dist/index.js products list
```

### Edge services

These build and run independently of the Node workspace. They are stateless apart
from in-memory caches/cursors.

**arc-indexer (Rust)** — watches USDC `Transfer` events to a payout address and
POSTs `POST {SETTLEKIT_API_URL}/v1/payments/{txHash}/confirm` with a Bearer key:

```bash
cd services/arc-indexer && cargo build --release
ARC_RPC_URL="https://rpc.arc.example/v1" \
ARC_USDC_ADDRESS="0xA0b8…eB48" \
WATCH_ADDRESS="0x…dEaD" \
SETTLEKIT_API_URL="https://api.example.com" \
SETTLEKIT_API_KEY="sk_live_…" \
CONFIRMATIONS=3 POLL_INTERVAL_SECS=12 \
./target/release/arc-indexer
```

**x402-gateway (Go)** — x402 pay-per-call reverse proxy in front of any upstream;
listens on `:8402`, `GET /healthz`:

```bash
cd services/x402-gateway && go build -o x402-gateway .
UPSTREAM_URL=http://localhost:9000 PRICE=0.005 NETWORK=arc \
PAY_TO=0xabc…000 PRODUCT_ID=prod_123 \
RESOURCE=https://api.example.com/premium \
X402_HMAC_SECRET="$(head -c 32 /dev/urandom | base64)" \
VERIFY_URL=https://api.example.com/verify \
./x402-gateway
```

**license-gateway (Rust)** — sub-ms cached verifier in front of the API verify
endpoints; listens on `8090`, `GET /healthz`:

```bash
cd services/license-gateway && cargo build --release
SETTLEKIT_API_KEY="sk_live_…" \
SETTLEKIT_API_URL="https://api.example.com" \
PORT=8090 CACHE_TTL_SECS=30 REQUEST_TIMEOUT_SECS=10 \
./target/release/license-gateway
```

**webhook-relay (Rust)** — fans out SettleKit events to subscriber URLs,
HMAC-signing each delivery; listens on `8091`, `GET /healthz`:

```bash
cd services/webhook-relay && cargo build --release
SIGNING_SECRET="whsec_…" PORT=8091 MAX_RETRIES=5 RETRY_BASE_MS=500 \
./target/release/webhook-relay
```

| Service | Port | Required env | Health |
| --- | --- | --- | --- |
| arc-indexer | — | `ARC_RPC_URL`, `ARC_USDC_ADDRESS`, `WATCH_ADDRESS`, `SETTLEKIT_API_URL`, `SETTLEKIT_API_KEY` | — (poll loop) |
| x402-gateway | 8402 | `UPSTREAM_URL`, `PRICE`, `NETWORK`, `PAY_TO`, `PRODUCT_ID`, `RESOURCE`, plus `NONCE` or `X402_HMAC_SECRET` | `/healthz` |
| license-gateway | 8090 | `SETTLEKIT_API_KEY` (others default) | `/healthz` |
| webhook-relay | 8091 | `SIGNING_SECRET` (min 8 chars) | `/healthz` |

---

## 5. Configuration & secrets

The complete env reference is [.env.example](./.env.example). Config is read once
at boot and **validated fail-fast**: a partially-configured integration group
(e.g. a GitHub App id with no private key) aborts startup with a `ConfigError`
rather than failing deep inside a job (`apps/api/src/config/env.ts`,
`apps/worker/src/config.ts`).

A key asymmetry to know: **the API treats every integration group as optional**
(falls back to in-memory clients when creds are absent), while **the worker
requires Arc, Resend, GitHub, Discord, file-delivery, license, and webhook
secrets** — `loadConfig` throws if any are missing. Provision the full secret set
before starting the worker.

### Required / important secrets

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | api, worker, checkout | PostgreSQL connection — **required in prod** |
| `PORT` | api, Next apps | Listen port (api default 8787) |
| `ARC_RPC_URL` / `ARC_USDC_ADDRESS` / `ARC_CHAIN_ID` | api, worker, arc-indexer | Arc USDC chain reads + on-chain settlement |
| `ARC_MIN_CONFIRMATIONS` | api, worker | Confirmations before settling (default 3) |
| `CIRCLE_API_KEY` | api | Circle Gateway / x402 payment rails |
| `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_INSTALLATION_ID` | api, worker | GitHub repo + team access delivery |
| `GITHUB_WEBHOOK_SECRET` | api | Verify inbound GitHub webhooks |
| `DISCORD_BOT_TOKEN` | api, worker | Discord role grants |
| `RESEND_API_KEY` / `EMAIL_FROM` | api, worker | Transactional email |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_ENDPOINT` | api | File asset storage (R2/S3) for downloads |
| `WEBHOOK_SIGNING_SECRET` | api, worker, webhook-relay (`SIGNING_SECRET`) | Sign outbound webhooks (HMAC) |
| `LICENSE_TOKEN_SECRET` | api, worker | Sign license tokens |
| `AUTH_COOKIE_SECRET` | api | Sign the `sk_session` cookie |
| `API_BOOTSTRAP_KEY` | api | Static key so the first caller can authenticate before any key exists |
| `FILE_DOWNLOAD_BASE_URL` / `FILE_DOWNLOAD_SECRET` (api); `FILE_DELIVERY_*` (worker) | api, worker | Signed download URLs |
| `NEXT_PUBLIC_API_URL` | Next apps | API base URL for the browser-facing apps |

> The API supplies dev fallbacks for `LICENSE_TOKEN_SECRET`,
> `WEBHOOK_SIGNING_SECRET`, `AUTH_COOKIE_SECRET`, and the file-download secret.
> These are **dev-only placeholders** — set real, high-entropy values in
> production. `API_BOOTSTRAP_KEY` should be set to a strong random value and
> rotated to a real issued key as soon as keys exist.

### Worker tuning (optional, with safe defaults)

`WORKER_DELIVERY_INTERVAL_MS` (5000), `WORKER_PAYMENT_INTERVAL_MS` (10000),
`WORKER_ACCESS_SYNC_INTERVAL_MS` (300000), `WORKER_RENEWAL_INTERVAL_MS` (600000),
`WORKER_WEBHOOK_RETRY_INTERVAL_MS` (30000), the email-sweep intervals,
`SUBSCRIPTION_GRACE_DAYS` (3), and `SUBSCRIPTION_RENEWAL_REMINDER_DAYS` (7). All
are bounded so a bad value cannot turn a sweep into a tight CPU loop.

---

## 6. Security

- **Request hardening (built-in middleware).** Every request runs through, in
  order: centralized **error mapping**, **CORS** (set `CORS_ORIGIN` to lock to
  your app origins; `*` by default), **request-id** propagation (`X-Request-Id`,
  inbound id honored), **structured request logging** (one JSON line per request
  to stdout — set `REQUEST_LOG=false` to silence), and a per-instance **rate
  limiter** (`RATE_LIMIT_PER_MINUTE`, default 600; `RATE_LIMIT_ENABLED=false` to
  disable). Rate-limited responses return `429` with `Retry-After` +
  `X-RateLimit-*` headers. `/health`, `/v1/auth/*`, and `/v1/paid/*` are exempt
  from rate limiting. The limiter is per-instance; for a global limit across a
  horizontally-scaled fleet, front it with a shared limiter at the edge.
- **API key auth.** Every `/v1/*` route except `/v1/auth` and `/v1/paid` requires
  `Authorization: Bearer <apiKey>`. Keys are verified against
  `@settlekit/api-keys`; `lastUsedAt` is stamped best-effort. `API_BOOTSTRAP_KEY`
  authenticates as the `bootstrap` identity before any key exists — treat it as a
  root credential.
- **Public auth + x402 paid endpoints.** `/v1/auth/*` is public so sign-up/sign-in
  work without a key. `/v1/paid/*` is intentionally public: the **USDC payment is
  the authorization**. An unpaid call returns `HTTP 402` with a machine-readable
  `PaymentRequirements` document; a call carrying a verified `X-Payment` proof is
  served and metered.
- **On-chain payment verification.** When Arc is configured, confirming a payment
  is gated on a real on-chain check: the submitted transaction must have
  transferred at least the invoiced USDC to the session's `payTo` address with
  `ARC_MIN_CONFIRMATIONS` confirmations before access is granted. This holds in
  both `POST /v1/payments/:id/confirm` and the hosted checkout. x402 paid calls
  use the same Arc verifier — with Arc unconfigured, the 402 challenge still works
  and any presented proof is **honestly rejected** (no mock acceptance).
- **Webhook signature verification.** Outbound webhooks carry
  `SettleKit-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>` and a
  `SettleKit-Event` header. The signed message is `"<timestamp>.<payloadJson>"`,
  binding the timestamp into the HMAC to defeat replay. Receivers recompute the
  HMAC over the exact raw body with `WEBHOOK_SIGNING_SECRET` and compare in
  constant time. (The standalone `webhook-relay` uses the same `v1=<hex>` scheme
  over the raw body.)
- **Error envelopes never leak internals.** Every error returns
  `{"error":{"code","message"}}`; success returns `{"data":T}`. The centralized
  error middleware maps `SettleKitError` to the right HTTP status.
- **Secret rotation.** Issue a new value, deploy it to the API and worker
  together (both read `WEBHOOK_SIGNING_SECRET` / `LICENSE_TOKEN_SECRET`), then
  retire the old one. Rotate `API_BOOTSTRAP_KEY` to a real issued key once keys
  exist. Never commit a real `.env`. Validate that required secrets are present
  at startup — the config loaders already enforce this.

### Pre-go-live security checklist

- [ ] No hardcoded secrets; all dev-fallback secrets replaced with real values.
- [ ] `DATABASE_URL`, `ARC_*`, `WEBHOOK_SIGNING_SECRET`, `LICENSE_TOKEN_SECRET`,
      `AUTH_COOKIE_SECRET` set to production values.
- [ ] `API_BOOTSTRAP_KEY` is high-entropy and access-restricted.
- [ ] Arc configured so payment confirmation is verified on-chain.
- [ ] TLS terminated in front of the API and all public services.
- [ ] Webhook receivers verify the `SettleKit-Signature` HMAC.

---

## 7. Scaling & operations

- **Stateless API — scale horizontally.** The API holds no per-process state;
  PostgreSQL is the shared state. Run N replicas behind a load balancer and scale
  on CPU/RPS. Each replica seeds the default org/merchant idempotently on boot.
- **Worker cardinality.** The worker runs interval-based jobs and skips a tick if
  the previous tick for that job is still running (`apps/worker/src/scheduler.ts`),
  so it tolerates slow ticks without overlap. The persistence-backed worker queues
  (`worker_delivery_queue`, `worker_webhook_jobs`, idempotency ledgers) make
  delivery idempotent. Run a single worker by default; if you run more than one,
  rely on the idempotency ledgers and per-action `DeliveryLog` to prevent
  double-grants.
- **Worker job intervals (defaults):** payment confirm 10s, delivery runner 5s,
  webhook retry 30s, receipt/access emails 60s, access sync 5m, renewal sweep
  10m, renewal-reminder/dunning emails 1h. Tune via the `WORKER_*` env vars (§5).
- **license-gateway cache.** Collapses repeated verify checks into one upstream
  call per `CACHE_TTL_SECS` (default 30s) window per distinct request, delivering
  sub-ms p99 on hits and shielding the API from verification stampedes. Scale it
  horizontally next to read-heavy downstreams; each instance has its own cache.
- **Health endpoints.** API: `GET /health` → `{"data":{"status":"ok",...}}`.
  Services: `GET /healthz` on x402-gateway (8402), license-gateway (8090),
  webhook-relay (8091). The worker has no HTTP port — monitor it via process
  liveness and job-tick logs.
- **Graceful shutdown.** The worker installs SIGINT/SIGTERM handlers that stop
  scheduling and drain in-flight ticks (up to 30s) before exit; the Go/Rust
  services shut down cleanly on SIGINT/SIGTERM. Set sane termination grace periods
  in your orchestrator.
- **Zero-downtime migrations.** Migrations are additive (document-projection means
  the full entity is always in `metadata.__doc`, so new projected columns don't
  break old readers). Deploy order: (1) apply migrations, (2) roll the API, (3)
  roll the worker. Because `drizzle-kit migrate` is idempotent and the schema is
  forward/backward tolerant for additive changes, a brief mixed-version window is
  safe.

---

## 8. Observability

- **Health & readiness.** `GET /health` is liveness (process up). `GET
  /health/ready` is readiness — in Postgres mode it pings the database and
  returns **503** when unreachable (point your load balancer / k8s readiness
  probe here so an instance with a broken DB connection is pulled from rotation).
- **Prometheus metrics.** `GET /metrics` exposes the text exposition format
  (`text/plain; version=0.0.4`): `settlekit_http_requests_total{method,status}`,
  `settlekit_http_requests_in_flight`, `settlekit_http_errors_total`, and the
  `settlekit_http_request_duration_seconds` histogram. Counters are per-instance —
  aggregate at the scraper. `/metrics`, `/health*` are unauthenticated for
  scraping.
- **Structured request logs.** The API emits one JSON line per request
  (`apps/api/src/middleware/logging.ts`): `method`, `path`, `status`,
  `durationMs`, `requestId`, `ip`. Correlate by `X-Request-Id` across services.
- **Structured worker logs.** The worker emits JSON logs (`apps/worker/src/logger.ts`)
  per job tick — `job`, `processed`, `failed`, `durationMs` — plus `job
  scheduled`, `job tick skipped`, and shutdown/drain events. Ship stdout/stderr to
  your log aggregator and alert on `level: error` and repeated `job tick threw`.
- **Worker health & metrics.** The worker runs a tiny HTTP server on
  `WORKER_HEALTH_PORT` (default 8788): `GET /health` + `/healthz` (liveness),
  `GET /ready` (readiness), and `GET /metrics` (Prometheus: `settlekit_worker_up`,
  `_uptime_seconds`, `_jobs`, `_ticks_total`, `_ticks_skipped_total`,
  `_ticks_errored_total`, `_items_processed_total`, `_items_failed_total`). Point
  the worker's liveness probe at `/health` and scrape `/metrics` for job
  throughput.
- **What to monitor:**
  - **Payment confirmation lag** — time between a payment being recorded and
    confirmed. Watch the `payment-confirm-job` tick `processed`/`failed` counts and
    correlate with `ARC_RPC_URL` latency and chain reorgs. Rising lag means Arc RPC
    or confirmation depth issues.
  - **Delivery failures** — `delivery-runner-job` `failed` counts and the
    `delivery_runs` / `delivery_logs` audit trail. Persistent failures usually mean
    a misconfigured GitHub/Discord/Resend integration.
  - **Webhook retry exhaustion** — the `webhook-retry-job` and webhook-relay
    delivery log. A delivery that exhausts `MAX_RETRIES` (relay default 5) is marked
    `failed`; alert on the failed-delivery rate and on subscriber endpoints returning
    non-2xx.
  - **Email send failures** — the receipt/renewal-reminder/dunning/access-granted
    email jobs; watch their `failed` counts (Resend outages).
  - **API health and latency** — poll `GET /health`; track p99 latency and 5xx
    rate. Track license-gateway cache hit ratio and upstream error rate.
- **Arc indexer** logs each poll cycle and skips malformed logs/API rejections
  without stalling; the cursor is in-memory, so on restart set `START_BLOCK` to
  backfill from a known height.

---

## 9. Go-live checklist

**Infrastructure**
- [ ] PostgreSQL 16 provisioned with backups/PITR; `DATABASE_URL` set.
- [ ] Migrations applied (`make db-migrate`) and verified.
- [ ] Object storage (R2/S3) bucket + credentials configured.

**Configuration & secrets**
- [ ] All required secrets set (§5); no dev-fallback secrets remain.
- [ ] Arc configured (`ARC_RPC_URL`, `ARC_USDC_ADDRESS`, `ARC_CHAIN_ID`,
      `ARC_MIN_CONFIRMATIONS`) so settlement is verified on-chain.
- [ ] GitHub App, Discord bot, Resend, and Circle credentials valid.
- [ ] `NEXT_PUBLIC_API_URL` points at the production API for all Next apps.

**Deployables**
- [ ] API running behind TLS + load balancer; `GET /health` green; ≥2 replicas.
- [ ] Worker running; job-tick logs flowing; graceful drain configured.
- [ ] Next apps (dashboard, marketplace, checkout, admin, docs) deployed on their
      ports and reachable.
- [ ] Edge services deployed as needed: arc-indexer reporting confirmations,
      license-gateway `/healthz` green, x402-gateway and webhook-relay `/healthz`
      green.

**Security & verification**
- [ ] Bearer API-key auth enforced; `API_BOOTSTRAP_KEY` strong and restricted.
- [ ] Webhook receivers verify the `SettleKit-Signature` HMAC.
- [ ] End-to-end smoke test: create product → checkout → on-chain pay → payment
      confirms → delivery run succeeds → entitlement granted → receipt email sent.

**Observability**
- [ ] Structured logs shipped and searchable.
- [ ] Alerts on payment confirmation lag, delivery failures, webhook retry
      exhaustion, and API 5xx rate.
