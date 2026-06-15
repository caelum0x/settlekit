# x402-gateway

A production **x402 pay-per-call reverse proxy** for SettleKit. It sits in front
of any HTTP upstream and enforces the [x402](https://www.x402.org/) "HTTP 402
pay-per-call" protocol:

- Unpaid requests get a `402 Payment Required` response advertising
  machine-readable payment requirements.
- Requests carrying a verified `X-Payment` proof are transparently
  reverse-proxied to the protected upstream.

It is **standard-library only** (`net/http`, `net/http/httputil`,
`encoding/json`, `crypto/hmac`, `crypto/sha256`, `encoding/base64`, `os`,
`log`, `time`, `context`) so it builds and runs offline with no external
dependencies.

The wire format (header names + payment-requirements JSON shape) is
byte-compatible with SettleKit's TypeScript `@settlekit/x402` middleware in
`packages/x402`, so the same clients work against either implementation.

## Build & run

```bash
cd services/x402-gateway
go build ./...
go vet ./...

# Run (local verification mode):
UPSTREAM_URL=http://localhost:9000 \
PRICE=0.005 \
NETWORK=arc \
PAY_TO=0xabc0000000000000000000000000000000000000 \
PRODUCT_ID=prod_123 \
RESOURCE=https://api.example.com/premium \
X402_HMAC_SECRET=$(head -c 32 /dev/urandom | base64) \
go run .
```

The gateway listens on `:8402` by default and exposes an unauthenticated
liveness probe at `GET /healthz`.

## Environment variables

| Variable           | Required | Default | Description                                                                                          |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `LISTEN_ADDR`      | no       | `:8402` | TCP address the HTTP server binds to.                                                                |
| `UPSTREAM_URL`     | **yes**  | —       | Origin that paid requests are reverse-proxied to.                                                    |
| `PRICE`            | **yes**  | —       | Decimal major-unit price per call, e.g. `0.005`.                                                     |
| `CURRENCY`         | no       | `USDC`  | Settlement asset. Only `USDC` is supported.                                                          |
| `NETWORK`          | **yes**  | —       | Settlement network: `arc`, `base`, or `ethereum`.                                                    |
| `PAY_TO`           | **yes**  | —       | Destination address payments must be sent to.                                                        |
| `PRODUCT_ID`       | **yes**  | —       | Product identifier for usage attribution.                                                            |
| `RESOURCE`         | **yes**  | —       | Canonical identifier of the protected resource.                                                      |
| `VERIFY_URL`       | no       | —       | When set, the gateway POSTs each proof here for verification and requires `{ "ok": true }`.          |
| `NONCE`            | no\*     | —       | Stable nonce advertised in every challenge and required to match on the paid retry.                  |
| `X402_HMAC_SECRET` | no\*     | —       | Secret used to derive a per-resource HMAC nonce when `NONCE` is unset.                               |

\* Either `NONCE` or `X402_HMAC_SECRET` must be set so challenge nonces can be
issued and verified. When `NONCE` is set it is used verbatim; otherwise a
deterministic HMAC-SHA256 nonce bound to the resource is generated, allowing
stateless local verification of the echoed nonce.

## Protocol flow

### 1. Unpaid request → 402 challenge

```
GET /premium HTTP/1.1
```

Response:

```
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
X-Payment-Required: {"scheme":"x402","amount":"0.005",...}
Accept-Payment:     {"scheme":"x402","amount":"0.005",...}

{
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "x402",
      "amount": "0.005",
      "asset": "USDC",
      "network": "arc",
      "payTo": "0xabc...",
      "productId": "prod_123",
      "resource": "https://api.example.com/premium",
      "nonce": "rR3v..."
    }
  ]
}
```

### 2. Client pays and retries with `X-Payment`

The client settles the transfer on-chain, then retries with a base64-encoded
JSON proof:

```json
{
  "txHash": "0xdeadbeef...",
  "from": "0xclient...",
  "amount": "0.005",
  "network": "arc",
  "nonce": "rR3v..."
}
```

```
GET /premium HTTP/1.1
X-Payment: eyJ0eEhhc2giOiIweGRlYWRiZWVmLi4uIiwuLi59
```

### 3. Gateway verifies, then proxies

- **Remote mode** (`VERIFY_URL` set): the gateway POSTs
  `{ "proof": {...}, "requirements": {...} }` to `VERIFY_URL` and requires a
  `2xx` response with JSON `{ "ok": true }`.
- **Local mode** (default): the gateway checks that the echoed `nonce` matches
  the challenge for the resource, the `network` matches, and the paid `amount`
  is `>= PRICE`.

On success the request is reverse-proxied to `UPSTREAM_URL` (the `X-Payment`
header is stripped before forwarding). On failure it returns a `402` with a
`reason` field explaining the rejection.

## Files

| File               | Responsibility                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| `main.go`          | Config load, HTTP server wiring, graceful shutdown on `SIGINT`/`SIGTERM`. |
| `config.go`        | Environment configuration loading + validation.                          |
| `gateway.go`       | The x402 request handler + reverse proxy.                                 |
| `requirements.go`  | Payment-requirements model, protocol constants, HMAC nonce helpers.       |
| `payment.go`       | `X-Payment` proof parsing/encoding (base64 JSON) + amount comparison.     |
| `verify.go`        | Local and remote (`VERIFY_URL`) payment verifiers.                        |

## Relationship to the SettleKit API

This gateway is an independent edge service. A natural deployment pattern is to
point `VERIFY_URL` at a settlement-verification endpoint (e.g. backed by the
SettleKit REST API in `apps/api`, which uses Bearer API-key auth and a
`{ "data" }` / `{ "error" }` envelope) so on-chain confirmation and usage
metering happen against your account. In local mode the gateway verifies
statelessly without any backend.
