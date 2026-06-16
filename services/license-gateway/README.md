# license-gateway

A high-performance **Rust verification gateway** that fronts the [SettleKit](../../apps/api)
HTTP API. It sits in front of SettleKit's verification endpoints and serves
repeated license / API-key / entitlement checks from an in-memory TTL cache, so
hot paths return in sub-millisecond time and the upstream API is shielded from
verification traffic spikes.

Built with **axum + tokio + reqwest + serde + dashmap**.

## Why a cache gateway matters

License, API-key, and entitlement checks tend to be:

- **Read-heavy and repetitive** — the same key is verified on nearly every
  request to a downstream service.
- **On the critical path** — every protected request blocks on a verification.

Calling the SettleKit API directly for each check couples your request latency
to the API's latency and database load, and turns a traffic spike into a
verification stampede. This gateway:

- **Protects the upstream API** by collapsing repeated checks into one upstream
  call per `CACHE_TTL_SECS` window, per distinct request.
- **Delivers sub-ms p99** on cache hits — a lock-free `DashMap` lookup with no
  network round-trip.
- **Fails safe and loud** — upstream errors are surfaced with their original
  `{ "error": { code, message } }` envelope and correct status codes; results
  are only cached on a definitive upstream answer.

## Configuration

All configuration comes from the environment:

| Variable               | Required | Default                  | Description                                    |
| ---------------------- | -------- | ------------------------ | ---------------------------------------------- |
| `SETTLEKIT_API_KEY`    | **yes**  | —                        | Bearer token sent as `Authorization: Bearer …` |
| `SETTLEKIT_API_URL`    | no       | `http://localhost:8787`  | Upstream SettleKit API base URL                |
| `PORT`                 | no       | `8090`                   | Port the gateway listens on                    |
| `CACHE_TTL_SECS`       | no       | `30`                     | How long verification results stay cached      |
| `REQUEST_TIMEOUT_SECS` | no       | `10`                     | Per-request timeout for upstream calls         |
| `RUST_LOG`             | no       | `info`                   | Tracing filter (e.g. `license_gateway=debug`)  |

## Endpoints

All bodies are JSON. Responses include a `cached` boolean indicating whether the
result was served from the in-memory cache.

### `GET /healthz`

```json
{ "status": "ok" }
```

### `POST /verify/license`

Request:

```json
{ "license_key": "LIC-...", "product_id": "prod_123", "machine_id": "mach_abc" }
```

Response:

```json
{ "active": true, "cached": false }
```

Proxies SettleKit `POST /v1/license-keys/verify`.

### `POST /verify/api-key`

Request:

```json
{ "key": "sk_live_...", "required_scopes": ["read", "write"] }
```

Response:

```json
{ "valid": true, "cached": false }
```

Proxies SettleKit `POST /v1/api-keys/verify`. Scope order does not affect cache
keying.

### `POST /verify/entitlement`

Request:

```json
{ "customer_id": "cust_123", "feature": "premium-export" }
```

Response:

```json
{ "allowed": true, "cached": false }
```

Proxies SettleKit `POST /v1/entitlements/verify`.

### Error envelope

Errors mirror SettleKit's shape with an appropriate non-2xx status:

```json
{ "error": { "code": "license_not_found", "message": "no such license key" } }
```

- `400 bad_request` — missing/empty required fields.
- `502 upstream_unreachable` — could not reach the SettleKit API or it timed out.
- `502 upstream_decode_error` — the upstream returned an unexpected body shape.
- The upstream status/code/message — propagated for structured upstream errors.

## Running

```bash
export SETTLEKIT_API_KEY="<your-api-key>"
export SETTLEKIT_API_URL="http://localhost:8787"
export PORT=8090
export CACHE_TTL_SECS=30

cargo run --release
```

## Example curl

```bash
# Health check
curl -s http://localhost:8090/healthz

# License verification (first call hits upstream, second is cached)
curl -s -X POST http://localhost:8090/verify/license \
  -H 'content-type: application/json' \
  -d '{"license_key":"LIC-ABC","product_id":"prod_123","machine_id":"mach_1"}'

# API key verification
curl -s -X POST http://localhost:8090/verify/api-key \
  -H 'content-type: application/json' \
  -d '{"key":"sk_live_xyz","required_scopes":["read"]}'

# Entitlement verification
curl -s -X POST http://localhost:8090/verify/entitlement \
  -H 'content-type: application/json' \
  -d '{"customer_id":"cust_123","feature":"premium-export"}'
```

## Project layout

```
license-gateway/
├── Cargo.toml         # package metadata + dependencies
└── src/
    ├── main.rs        # bootstrap: tracing, config, router, serve, graceful shutdown
    ├── config.rs      # typed env config with defaults + validation
    ├── client.rs      # reqwest client for SettleKit verify endpoints (envelope parsing)
    ├── cache.rs       # DashMap-based TTL cache with expiry + opportunistic sweep
    ├── routes.rs      # axum handlers + shared state + request-hash cache keying
    └── error.rs       # error enum implementing IntoResponse (JSON + status codes)
```

## Tests

Unit tests cover the cache TTL/expiry behavior and the collision-resistant cache
keying:

```bash
cargo test
```
