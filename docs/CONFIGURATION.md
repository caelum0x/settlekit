# Configuration Reference

This is the authoritative reference for **every** environment variable read by
SettleKit. It is generated from the actual configuration loaders in the source
tree, not from documentation prose:

| Component | Config source |
| --- | --- |
| API (`apps/api`) | `apps/api/src/config/env.ts`, plus direct `process.env` reads in `src/context.ts`, `src/middleware/auth.ts`, `src/routes/auth.ts`, `src/routes/x402.ts`, `src/server.ts` |
| Worker (`apps/worker`) | `apps/worker/src/config.ts` |
| x402 Gateway (`services/x402-gateway`) | `config.go` |
| Arc Indexer (`services/arc-indexer`) | `src/config.rs` |
| License Gateway (`services/license-gateway`) | `src/config.rs` |
| Webhook Relay (`services/webhook-relay`) | `src/config.rs` |
| Node SDK (`packages/sdk`) | `src/index.ts` |
| Python SDK (`sdks/python`) | `settlekit/_transport.py`, `settlekit/x402.py` |
| Go CLI (`clis/agentpay`) | `internal/client/client.go` |
| Next.js apps (`apps/dashboard`, `checkout`, `marketplace`, `admin`, `docs`, `web`, `portal`) | `process.env.NEXT_PUBLIC_API_URL`, `PORT` |

## How configuration is loaded

### API — every integration is optional

The API loader (`loadConfig` in `apps/api/src/config/env.ts`) is designed so the
API **boots with zero integrations configured**. Each integration group is one
of three states:

- **Absent** — none of the group's keys are set → the in-memory client double in
  `apps/api/src/clients/` is used instead of the real integration.
- **Present** — all of the group's required keys are set → the real client is
  constructed and a `has*` flag flips to `true`.
- **Partial** — some but not all keys set → boot fails fast with a `ConfigError`
  listing exactly which keys to set or unset. This prevents silent half-wired
  integrations.

Persistence follows the same rule: set `DATABASE_URL` and the API/worker use
Postgres via `@settlekit/persistence`; leave it unset and they run against a
process-local in-memory store.

### Worker — integrations are required

Unlike the API, the worker (`apps/worker/src/config.ts`) **requires** Arc, email,
GitHub, Discord, file-delivery, license, and the webhook signing secret to be
present, because every background job depends on at least one of them. Missing
required values fail fast at boot with a precise message. `DATABASE_URL` remains
optional (in-memory fallback). Numeric job intervals are range-bounded so a bad
value cannot turn a sweep into a tight CPU loop.

### Services — fail-fast Rust/Go loaders

Each Rust/Go service validates its own environment at startup and refuses to
start on a missing required value or a malformed one (bad port, non-hex address,
zero timeout, etc.).

---

## API (`apps/api`) — port 8787

Built from `apps/api/src/config/env.ts` plus the direct `process.env` reads noted
above.

### Always-present settings (have defaults)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `8787` | TCP port the API binds to. Range 1–65535. Also read directly in `server.ts`. |
| `LICENSE_TOKEN_SECRET` | no | `settlekit-dev-license-secret` | HMAC secret used to sign license-key tokens. **Override in production.** |
| `WEBHOOK_SIGNING_SECRET` | no | `settlekit-dev-webhook-secret` | HMAC secret used to sign outbound webhook payloads so receivers can verify them. **Override in production.** |
| `AUTH_COOKIE_SECRET` | no | `settlekit-dev-auth-cookie-secret` | HMAC secret used to sign the `sk_session` auth cookie. **Override in production.** |
| `FILE_DOWNLOAD_BASE_URL` | no | `http://localhost:8787/v1/files/download` | Base URL embedded in signed file-download links. |
| `FILE_DOWNLOAD_SECRET` | no | `settlekit-dev-file-secret` | HMAC secret used to sign file-download URLs. **Override in production.** |
| `FILE_DOWNLOAD_EXPIRES_SEC` | no | `3600` | Default lifetime (seconds) of a signed download link. Range 60–2,592,000. |
| `FILE_DOWNLOAD_MAX_DOWNLOADS` | no | `3` | Default max downloads per signed link. Range 1–10,000. |

> Note: the API and worker use **different** env-var names for the file-delivery
> group (`FILE_DOWNLOAD_*` in the API vs `FILE_DELIVERY_*` in the worker). Set
> both if you run both processes.

### Authentication, merchant identity, runtime (direct `process.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `API_BOOTSTRAP_KEY` | no | _(unset)_ | Static bootstrap Bearer key accepted by `authMiddleware` so the very first authenticated call can create real API keys. Read in `src/middleware/auth.ts`. Leave unset once real keys exist. |
| `NODE_ENV` | no | _(unset)_ | When `production`, the `sk_session` auth cookie is set `Secure`. Read in `src/routes/auth.ts`. |
| `MERCHANT_NAME` | no | `SettleKit Merchant` | Display name for the merchant identity used on invoices/receipts. Read in `src/context.ts`. |
| `MERCHANT_EMAIL` | no | _(unset)_ | Optional merchant contact email surfaced on invoices/receipts. |
| `MERCHANT_WEBSITE` | no | _(unset)_ | Optional merchant website surfaced on invoices/receipts. |
| `X402_PAY_TO` | no | `0x0000000000000000000000000000000000000000` | Destination USDC address advertised in the `/v1/paid/research` x402 challenge. Read in `src/routes/x402.ts`. Set to your real wallet to actually receive payment. |

### Database (optional group)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | no | _(unset → in-memory)_ | PostgreSQL connection string. When set, the API persists via `@settlekit/persistence` (drizzle, document-projection). When unset, an in-memory store is used. |

### Arc / USDC settlement (optional group — all-or-none)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ARC_RPC_URL` | group | _(unset)_ | JSON-RPC endpoint for the Arc network used to read/verify USDC transfers. Required if any `ARC_*` is set. |
| `ARC_USDC_ADDRESS` | group | _(unset)_ | USDC ERC-20 contract address on Arc. Must be a `0x`-prefixed 20-byte address. Required if any `ARC_*` is set. |
| `ARC_CHAIN_ID` | group | _(unset)_ | Numeric chain id for the Arc network. Range 1–2,147,483,647. Required if any `ARC_*` is set. |
| `ARC_MIN_CONFIRMATIONS` | no | `3` | Confirmations required before a payment is treated as settled. Range 1–1000. |

Setting any one of `ARC_RPC_URL` / `ARC_USDC_ADDRESS` / `ARC_CHAIN_ID` without
the other two fails boot. Without the Arc group, x402 paid endpoints return an
honest rejection (`x402 settlement requires Arc (set ARC_RPC_URL)`).

### Circle (optional group)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `CIRCLE_API_KEY` | group | _(unset)_ | Circle API key for Gateway / x402 settlement rails. Presence enables the real Circle client. |
| `CIRCLE_BASE_URL` | no | _(SDK default)_ | Override Circle API base URL (e.g. for sandbox). Only meaningful when `CIRCLE_API_KEY` is set. |

### GitHub App (optional group — all-or-none)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GITHUB_APP_ID` | group | _(unset)_ | Numeric GitHub App id. Range 1–2,147,483,647. |
| `GITHUB_APP_PRIVATE_KEY` | group | _(unset)_ | GitHub App private key (PEM). Use literal `\n` escapes or a single-line PEM. |
| `GITHUB_INSTALLATION_ID` | group | _(unset)_ | Default installation id the API/worker authenticate as. Range 1–2,147,483,647. |
| `GITHUB_WEBHOOK_SECRET` | no | _(unset)_ | Secret used to verify inbound GitHub webhook signatures. Optional within the group. |

Required group keys: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_INSTALLATION_ID`. Setting some but not all fails boot.

### Discord (optional group)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DISCORD_BOT_TOKEN` | group | _(unset)_ | Bot token used to add/remove Discord roles on purchase. Presence enables the real Discord client. |

### Email / Resend (optional group — all-or-none)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | group | _(unset)_ | Resend API key for transactional delivery/receipt email. |
| `EMAIL_FROM` | group | _(unset)_ | From address for outbound transactional email. |

Setting one without the other fails boot.

### S3 / R2 object storage (optional group — all-or-none)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `S3_BUCKET` | group | _(unset)_ | Bucket holding sellable file assets. |
| `S3_REGION` | group | _(unset)_ | S3/R2 region. Use `auto` for Cloudflare R2. |
| `S3_ACCESS_KEY_ID` | group | _(unset)_ | S3/R2 access key id. |
| `S3_SECRET_ACCESS_KEY` | group | _(unset)_ | S3/R2 secret access key. |
| `S3_ENDPOINT` | no | _(native AWS S3)_ | S3/R2 endpoint URL. Required for R2; omit for native AWS S3. Optional within the group. |

Required group keys: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`.

---

## Worker (`apps/worker`)

Built from `apps/worker/src/config.ts`. The worker runs the recurring jobs
(delivery, payment confirmation, access sync, renewals, webhook retry, and the
email sweeps). Required variables fail boot if missing.

### Required integrations

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ARC_RPC_URL` | **yes** | — | JSON-RPC endpoint used to confirm on-chain USDC settlement. |
| `ARC_USDC_ADDRESS` | **yes** | — | USDC contract address (`0x` 20-byte). |
| `ARC_CHAIN_ID` | no | `1` | Arc chain id. Range 1–2,147,483,647. |
| `ARC_MIN_CONFIRMATIONS` | no | `3` | Confirmations before a payment is settled. Range 1–1000. |
| `RESEND_API_KEY` | **yes** | — | Resend API key for receipt/reminder/dunning/access emails. |
| `EMAIL_FROM` | no | `SettleKit <receipts@settlekit.dev>` | From address for worker-sent email. |
| `GITHUB_APP_ID` | no | `1` | GitHub App id used for access reconciliation. Range 1–2,147,483,647. |
| `GITHUB_APP_PRIVATE_KEY` | **yes** | — | GitHub App private key (PEM). |
| `GITHUB_INSTALLATION_ID` | no | `1` | Installation id the worker authenticates as. Range 1–2,147,483,647. |
| `DISCORD_BOT_TOKEN` | **yes** | — | Bot token used to revoke/grant Discord roles during access sync. |
| `FILE_DELIVERY_BASE_URL` | **yes** | — | Base URL embedded in worker-generated signed download links. |
| `FILE_DELIVERY_SECRET` | **yes** | — | HMAC secret used to sign worker-generated download URLs. |
| `FILE_DELIVERY_EXPIRES_SEC` | no | `3600` | Signed-link lifetime (seconds). Range 60–2,592,000. |
| `FILE_DELIVERY_MAX_DOWNLOADS` | no | `5` | Max downloads per signed link. Range 1–10,000. |
| `LICENSE_TOKEN_SECRET` | **yes** | — | HMAC secret used to sign license tokens (must match the API). |
| `WEBHOOK_SIGNING_SECRET` | **yes** | — | HMAC secret used to sign outbound webhooks dispatched by delivery actions (must match the API). |

### Subscription / dunning tuning

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SUBSCRIPTION_GRACE_DAYS` | no | `3` | Grace window (days) applied when a renewal is missed. Range 1–365. |
| `SUBSCRIPTION_RENEWAL_REMINDER_DAYS` | no | `7` | Send a renewal reminder when `currentPeriodEnd` is within this many days. Range 1–365. |

### Job intervals (milliseconds)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `WORKER_DELIVERY_INTERVAL_MS` | no | `5000` | How often pending delivery runs execute. Range 250–3,600,000. |
| `WORKER_PAYMENT_INTERVAL_MS` | no | `10000` | How often pending payments are polled for on-chain confirmation. Range 250–3,600,000. |
| `WORKER_ACCESS_SYNC_INTERVAL_MS` | no | `300000` | How often access is reconciled and expired grants revoked. Range 1,000–86,400,000. |
| `WORKER_RENEWAL_INTERVAL_MS` | no | `600000` | How often subscriptions are advanced/graced/expired. Range 1,000–86,400,000. |
| `WORKER_WEBHOOK_RETRY_INTERVAL_MS` | no | `30000` | How often failed webhooks are redelivered. Range 1,000–86,400,000. |
| `WORKER_RECEIPT_EMAIL_INTERVAL_MS` | no | `60000` | How often confirmed payments are swept for an unsent receipt email. Range 1,000–86,400,000. |
| `WORKER_RENEWAL_REMINDER_INTERVAL_MS` | no | `3600000` | How often upcoming renewals are swept for a reminder email. Range 1,000–86,400,000. |
| `WORKER_DUNNING_EMAIL_INTERVAL_MS` | no | `3600000` | How often grace/past-due subscriptions are swept for a dunning email. Range 1,000–86,400,000. |
| `WORKER_ACCESS_EMAIL_INTERVAL_MS` | no | `60000` | How often succeeded delivery runs are swept for an access-granted email. Range 1,000–86,400,000. |

### Persistence

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | no | _(unset → in-memory)_ | Shared Postgres connection. When set, the worker reads/persists to the shared database; when unset it runs against a process-local in-memory store. |

---

## x402 Gateway (`services/x402-gateway`) — Go

Standalone reverse proxy that gates an upstream origin behind an x402 USDC
paywall. Built from `services/x402-gateway/config.go`. Fails fast on any missing
required var or malformed value.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `LISTEN_ADDR` | no | `:8402` | TCP address the HTTP server binds to. |
| `UPSTREAM_URL` | **yes** | — | Origin that paid requests are reverse-proxied to. Must be a valid URL. |
| `PRICE` | **yes** | — | Decimal major-unit price owed per call, e.g. `0.005`. Must be a non-negative decimal. |
| `CURRENCY` | no | `USDC` | Settlement asset. Only `USDC` is supported. |
| `NETWORK` | **yes** | — | Chain a payment must settle on. One of `arc`, `base`, `ethereum`. |
| `PAY_TO` | **yes** | — | Destination address payments must be sent to. |
| `PRODUCT_ID` | **yes** | — | Product id attributing the gated call for usage accounting. |
| `RESOURCE` | **yes** | — | Canonical identifier of the protected resource. |
| `VERIFY_URL` | no | _(local verify)_ | When set, a payment proof is POSTed here; the verifier must respond `{ "ok": true }`. Must be a valid URL. |
| `NONCE` | conditional | _(derived)_ | Stable nonce advertised in every challenge. If empty, an HMAC-derived nonce is used instead. |
| `X402_HMAC_SECRET` | conditional | — | Secret that signs derived nonces. **Either `NONCE` or `X402_HMAC_SECRET` must be set**, or boot fails. |

---

## Arc Indexer (`services/arc-indexer`) — Rust

Polls an Arc/EVM node for USDC `Transfer` events to a watched address and posts
confirmations to the SettleKit API. Built from `services/arc-indexer/src/config.rs`.
Addresses are normalized to lowercase `0x` + 40 hex; required vars fail fast.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ARC_RPC_URL` | **yes** | — | JSON-RPC HTTP endpoint of the Arc/EVM node. |
| `ARC_USDC_ADDRESS` | **yes** | — | USDC ERC-20 contract address (20-byte hex, with or without `0x`). |
| `WATCH_ADDRESS` | **yes** | — | Payout address to watch as the `to` of relevant Transfer events. |
| `SETTLEKIT_API_URL` | **yes** | — | Base URL of the SettleKit API (trailing slash trimmed). |
| `SETTLEKIT_API_KEY` | **yes** | — | Bearer API key used to authenticate confirmation requests. |
| `POLL_INTERVAL_SECS` | no | `12` | Seconds between RPC polls. Must be greater than zero. |
| `CONFIRMATIONS` | no | `3` | Confirmations required before a transfer is posted to the API. |
| `START_BLOCK` | no | _(chain head)_ | Optional starting block. When unset, the indexer starts at the chain head. |

---

## License Gateway (`services/license-gateway`) — Rust, port 8090

Edge service that verifies license keys against the SettleKit API with a local
verification cache. Built from `services/license-gateway/src/config.rs`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SETTLEKIT_API_URL` | no | `http://localhost:8787` | Base URL of the upstream SettleKit API (trailing slash trimmed). |
| `SETTLEKIT_API_KEY` | **yes** | — | Bearer API key used to authenticate against the SettleKit API. |
| `PORT` | no | `8090` | TCP port the gateway binds to. Must be 1–65535. |
| `CACHE_TTL_SECS` | no | `30` | How long a cached verification result remains valid. |
| `REQUEST_TIMEOUT_SECS` | no | `10` | Timeout applied to each upstream HTTP request. Must be greater than zero. |

---

## Webhook Relay (`services/webhook-relay`) — Rust, port 8091

Standalone HMAC-signing webhook fan-out/redelivery service. Built from
`services/webhook-relay/src/config.rs`.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `8091` | TCP port the HTTP server binds to. |
| `SIGNING_SECRET` | **yes** | — | HMAC-SHA256 secret applied to every outbound delivery body. Must be at least 8 characters. |
| `MAX_RETRIES` | no | `5` | Max delivery attempts per subscriber before giving up. Must be greater than zero. |
| `RETRY_BASE_MS` | no | `500` | Base delay (ms) for the exponential backoff schedule. Must be greater than zero. |

---

## SDKs and CLIs

All first-party SDKs and the CLI resolve the API base URL and key from the same
two environment variables (constructor arguments take precedence).

| Variable | Required | Default | Read by | Purpose |
| --- | --- | --- | --- | --- |
| `SETTLEKIT_API_URL` | no | `http://localhost:8787` | Python SDK, Go CLI (`agentpay`), Arc Indexer, License Gateway; Node SDK by convention | Base URL of the SettleKit HTTP API. |
| `SETTLEKIT_API_KEY` | yes¹ | _(none)_ | Node SDK, Python SDK, Go CLI, Arc Indexer, License Gateway | Bearer token sent as `Authorization: Bearer <key>`. |

¹ Required for authenticated calls. The Python SDK raises if neither an argument
nor `SETTLEKIT_API_KEY` is provided. The Go CLI sends it only when set
(unauthenticated public endpoints work without it).

### Python SDK x402 example helpers (`sdks/python/examples`)

These are read only by the bundled paid-API example, not by the core SDK:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SETTLEKIT_PAY_TO` | `0xYourMerchantWalletAddress` | Destination wallet advertised in the example's x402 challenge. |
| `SETTLEKIT_NETWORK` | `base` | Settlement network for the example. |
| `SETTLEKIT_VERIFY_MODE` | `accept` | Verifier mode; set to `api` to verify proofs against the API. |

---

## Next.js apps (dashboard 3001, marketplace 3002, checkout 3003, admin 3004, docs 3005)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | no | `http://localhost:8787` | Public base URL of the SettleKit API, read by the browser-facing Next apps. Must be `NEXT_PUBLIC_*` to be exposed to the client bundle. |
| `PORT` | no | per-app | Listen port when an app is started with `next dev/start -p $PORT`. Default ports: dashboard 3001, marketplace 3002, checkout 3003, admin 3004, docs 3005. |

---

## Quick start

### Minimal local development (in-memory, no integrations)

The API boots with **no** variables set — every integration falls back to its
in-memory double and persistence is in-memory:

```bash
pnpm --filter @settlekit/api dev
```

Optionally pin a port and a bootstrap key so you can create real API keys:

```bash
PORT=8787 API_BOOTSTRAP_KEY=dev_bootstrap_key pnpm --filter @settlekit/api dev
```

### With Postgres persistence

```bash
export DATABASE_URL="postgresql://settlekit:settlekit@localhost:5432/settlekit"
pnpm --filter @settlekit/database db:migrate   # or: make db-migrate
pnpm --filter @settlekit/api dev
```

### Production secrets to override

These have insecure development defaults and **must** be set to strong, unique
values in production (and must match between the API and worker where noted):

- `LICENSE_TOKEN_SECRET` (API + worker — must match)
- `WEBHOOK_SIGNING_SECRET` (API + worker — must match)
- `AUTH_COOKIE_SECRET` (API)
- `FILE_DOWNLOAD_SECRET` (API) / `FILE_DELIVERY_SECRET` (worker)
- `SIGNING_SECRET` (webhook-relay, ≥ 8 chars)
- `X402_HMAC_SECRET` (x402-gateway)
- Unset `API_BOOTSTRAP_KEY` once real API keys exist.

### API envelope and auth recap

- Success responses: `{"data": T}`. Errors: `{"error": {"code", "message"}}`.
- Authenticated endpoints require `Authorization: Bearer <apiKey>`.
- x402 paid endpoints under `/v1/paid/*` are public and return HTTP 402 +
  `PaymentRequirements` until a valid USDC payment proof is supplied; settlement
  is verified on-chain via Arc when `ARC_*` is configured.
</content>
</invoke>
