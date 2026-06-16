# webhook-relay

A small Rust microservice that receives **SettleKit webhook events** and fans them
out to any number of subscriber URLs. Each outbound delivery is HMAC-signed with
the canonical SettleKit `t=<ts>,v1=<hex>` scheme, retried with exponential backoff,
and recorded in an in-memory delivery log.

Built with [axum](https://github.com/tokio-rs/axum) 0.7, [tokio](https://tokio.rs),
and [reqwest](https://github.com/seanmonstar/reqwest) (rustls). The `POST /events`
handler returns immediately — actual HTTP delivery runs on spawned tokio tasks.

## Architecture

| Module             | Responsibility                                                            |
| ------------------ | ------------------------------------------------------------------------- |
| `config.rs`        | Env-driven configuration with fail-fast validation.                       |
| `signer.rs`        | HMAC-SHA256 signing producing `t=<ts>,v1=<hex>` over `"<t>.<raw body>"`.  |
| `subscribers.rs`   | Concurrent `DashMap` registry of subscriber endpoints + filtering.        |
| `relay.rs`         | Fan-out engine: select subscribers, POST with backoff, delivery log.      |
| `routes.rs`        | Axum handlers and router.                                                 |
| `error.rs`         | `RelayError` rendered as the SettleKit `{"error":{code,message}}` envelope.|
| `main.rs`          | Wiring + graceful shutdown.                                               |

## Configuration

All configuration comes from the environment and is validated at startup.

| Variable         | Required | Default | Description                                            |
| ---------------- | -------- | ------- | ------------------------------------------------------ |
| `SIGNING_SECRET` | **yes**  | —       | HMAC key applied to every outbound body (min 8 chars). |
| `PORT`           | no       | `8091`  | TCP port the HTTP server binds to.                     |
| `MAX_RETRIES`    | no       | `5`     | Maximum delivery attempts per subscriber (> 0).        |
| `RETRY_BASE_MS`  | no       | `500`   | Backoff base in ms (> 0). Delay = `base * 2^attempt`.  |
| `RUST_LOG`       | no       | `info`  | Tracing filter, e.g. `webhook_relay=debug`.            |

## Running

```bash
# from services/webhook-relay/
SIGNING_SECRET="whsec_super_secret_value" \
PORT=8091 \
MAX_RETRIES=5 \
RETRY_BASE_MS=500 \
cargo run --release
```

```bash
# tests
cargo test
```

## Endpoints

All success responses use the SettleKit envelope `{"data": ...}`; errors return a
non-2xx status with `{"error":{"code","message"}}`.

| Method   | Path                | Description                                              |
| -------- | ------------------- | ------------------------------------------------------- |
| `GET`    | `/healthz`          | Liveness probe.                                         |
| `POST`   | `/subscribers`      | Register a subscriber. Returns `201` + the record.      |
| `GET`    | `/subscribers`      | List all subscribers.                                   |
| `DELETE` | `/subscribers/:id`  | Remove a subscriber. `404` if unknown.                  |
| `POST`   | `/events`           | Accept an event, fan out, return `202` + delivery ids.  |
| `GET`    | `/deliveries`       | Recent delivery log (`?limit=` 1..1000, default 100).   |

### Subscriber shape

```json
{
  "id": "b1f1...",
  "url": "https://example.com/hook",
  "event_types": ["payment.created", "refund.created"],
  "active": true
}
```

`event_types` is a filter — an **empty list matches all events**. On register,
`event_types` defaults to `[]` and `active` defaults to `true`.

### Event shape (`POST /events`)

Matches the SettleKit webhook payload `{id?, type, data, createdAt?}`. `id` and
`createdAt` are synthesized when omitted; the exact serialized JSON is what gets
signed and delivered.

```json
{
  "type": "payment.created",
  "data": { "id": "pay_123", "amount": { "amount": "25.00", "currency": "USDC" } }
}
```

### Delivery record (`GET /deliveries`)

```json
{
  "id": "9c2e...",
  "subscriber_id": "b1f1...",
  "url": "https://example.com/hook",
  "event_type": "payment.created",
  "status": "delivered",          // pending | delivered | failed
  "attempts": 1,
  "last_status": 200,
  "last_error": null
}
```

## Signing scheme

Every delivery carries:

```
SettleKit-Signature: t=<unix-seconds>,v1=<hex>
SettleKit-Event: <event.type>
Content-Type: application/json
```

where `<hex>` is the lower-case hex `HMAC-SHA256(SIGNING_SECRET, "<t>.<raw_json_body>")`.
This is the canonical (Stripe-style) SettleKit webhook scheme — identical to what
the API itself signs — so the constant-time `verify_signature` helpers shipped in
every SettleKit SDK (TypeScript, Python, Go, Rust) accept relay deliveries without
special-casing. Subscribers verify by recomputing the HMAC over `"<t>.<exact
received body>"` and comparing in constant time, optionally rejecting a stale `t`
for replay protection.

Verify with any SDK (no re-implementation needed), e.g. TypeScript:

```js
import { verifyWebhookSignature } from "@settlekit/sdk";

const ok = verifyWebhookSignature(secret, rawBody, req.header("SettleKit-Signature"));
```

…or by hand in Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((s) => s.trim().split("=")));
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Retry / backoff

Each delivery is attempted up to `MAX_RETRIES` times. The first attempt fires
immediately; before attempt `n` (1-indexed from 0) the task sleeps
`RETRY_BASE_MS * 2^n` milliseconds. With defaults (`base=500`, `retries=5`):

```
attempt 0: 0ms
attempt 1: 1000ms
attempt 2: 2000ms
attempt 3: 4000ms
attempt 4: 8000ms
```

A 2xx response marks the delivery `delivered` and stops retrying. Exhausting all
attempts marks it `failed`. `last_status: 0` indicates a transport-level failure
(connection refused, timeout, DNS), with details in `last_error`.

## Example: end-to-end with curl

```bash
# 1. Register a subscriber (receives all events).
curl -s -X POST http://localhost:8091/subscribers \
  -H 'content-type: application/json' \
  -d '{"url":"https://webhook.site/your-uuid","event_types":["payment.created"]}'
# -> 201 {"data":{"id":"<sub-id>","url":"...","event_types":["payment.created"],"active":true}}

# 2. List subscribers.
curl -s http://localhost:8091/subscribers

# 3. Emit an event — fans out to matching subscribers.
curl -s -X POST http://localhost:8091/events \
  -H 'content-type: application/json' \
  -d '{
        "type":"payment.created",
        "data":{"id":"pay_123","amount":{"amount":"25.00","currency":"USDC"}}
      }'
# -> 202 {"data":{"eventId":"evt_...","type":"payment.created","deliveryIds":["<id>"],"subscriberCount":1}}

# 4. Inspect the delivery log.
curl -s 'http://localhost:8091/deliveries?limit=20'

# 5. Remove the subscriber.
curl -s -X DELETE http://localhost:8091/subscribers/<sub-id>
```

## Relationship to SettleKit

This relay is a self-contained fan-out layer. It mirrors the SettleKit webhook
signing scheme (`SettleKit-Signature: t=<ts>,v1=<hmac sha256 of "<t>.<raw body>">`)
and event payload shape (`{id, type, data, createdAt}`) so that subscribers written
against SettleKit's first-party webhooks — including the SDK `verify_signature`
helpers — can consume relayed events unchanged.
