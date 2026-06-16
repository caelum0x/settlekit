# settlekit-express-paid-api

A runnable **Express (TypeScript)** example that **sells API calls in USDC** via
the [x402](https://www.x402.org/) "HTTP 402 pay-per-call" protocol, using
[`@settlekit/x402`](../../packages/x402).

- `GET /health` — **FREE** liveness probe.
- `GET /research` — **PAID**. Gated behind a verified x402 payment of
  **0.005 USDC** on the `arc` network.

An unpaid request to `/research` returns **HTTP 402** with machine-readable
payment requirements. The client pays USDC on-chain, then retries the request
with an `X-Payment` header carrying the proof. The server confirms the
settlement with the SettleKit API before serving the paid result.

---

## How it works

`@settlekit/x402` exposes `withSettleKitPayment(config)(handler)`, where
`handler` is a **web Fetch handler** (`Request -> Response`). Express, however,
uses the classic `(req, res)` idiom. This example bridges the two with a small,
fully-implemented adapter (`src/express-adapter.ts`) that:

1. Builds a web `Request` from the Express `req` — method, absolute URL, **all**
   headers (including `Authorization` and `X-Payment`), and the request body.
2. Runs the wrapped Fetch handler.
3. Copies the returned `Response` (status, headers, body) back onto `res`.

```
GET /research ──▶ expressFromFetch( withSettleKitPayment({...})( researchHandler ) )
                       │                      │                          │
                  Express req            x402 gate:               paid result
                  ⇄ web Request       402 challenge or            (Request→Response)
                  ⇄ web Response       verify X-Payment
```

Payment verification lives in `src/verify.ts`: a real, `fetch`-based
`PaymentVerifier` that POSTs the proof + challenge requirements to a configurable
SettleKit verify endpoint. **It never blanket-accepts** — when no verify URL is
configured it honestly rejects every proof.

### Files

| File | Purpose |
| --- | --- |
| `src/server.ts` | Express app: free `/health`, paid `/research`. |
| `src/express-adapter.ts` | Express `(req,res)` ⇄ web `Request`/`Response` adapter. |
| `src/verify.ts` | `fetch`-based SettleKit `PaymentVerifier` (honest rejection by default). |
| `src/x402.ts` | Re-exports the `@settlekit/x402` API (see note below). |

---

## Prerequisites

### 1. Build `@settlekit/x402` first

This example imports the package by a **relative path to its compiled output**
(`../../packages/x402/dist/index.js`). The `examples/` directory is not part of
the pnpm workspace, so a `workspace:*` dependency would not resolve here.

Build the package from the **monorepo root**:

```bash
pnpm --filter @settlekit/x402 build
```

> **Alternative — import `@settlekit/x402` by name.** If you add this example to
> the workspace (or install the published package), edit `src/x402.ts` and change
> the import specifiers from `"../../../packages/x402/dist/index.js"` to
> `"@settlekit/x402"`. Nothing else changes — every other file imports x402
> through `src/x402.ts`.

### 2. Install this example's dependencies

```bash
# from examples/express-paid-api
pnpm install      # or: npm install
```

---

## Configuration

Set via environment variables:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `PAY_TO` | **yes** | — | USDC destination address advertised in the 402 challenge. |
| `PORT` | no | `3000` | Port to listen on. |
| `SETTLEKIT_API_URL` | no | — | SettleKit API base, e.g. `http://localhost:8787`. When set, the verifier POSTs to `${SETTLEKIT_API_URL}/v1/paid/research/verify`. |
| `SETTLEKIT_API_KEY` | no | — | Bearer key sent as `Authorization: Bearer <key>` to the verify endpoint. |

> Without `SETTLEKIT_API_URL` (or an explicit `verifyUrl`), the verifier rejects
> every payment by design — it will not grant free access.

---

## Run

```bash
export PAY_TO=0xYourUsdcDestinationAddress
export SETTLEKIT_API_URL=http://localhost:8787
export SETTLEKIT_API_KEY=sk_test_your_key

pnpm dev          # tsx watch src/server.ts
# or
pnpm build && pnpm start
```

```
settlekit-express-paid-api listening on http://localhost:3000
  FREE  GET /health
  PAID  GET /research  (0.005 USDC via x402, payTo=0xYour...)
```

---

## Try it

### Free route

```bash
curl -s http://localhost:3000/health
# {"data":{"status":"ok","service":"settlekit-express-paid-api","time":"..."}}
```

### Paid route — step 1: get the 402 challenge

```bash
curl -i http://localhost:3000/research
```

```
HTTP/1.1 402 Payment Required
Content-Type: application/json; charset=utf-8
X-Payment-Required: {"scheme":"x402","amount":"0.005","asset":"USDC","network":"arc",...}
Accept-Payment: {"scheme":"x402",...}

{
  "error": "payment_required",
  "accepts": [
    {
      "scheme": "x402",
      "amount": "0.005",
      "asset": "USDC",
      "network": "arc",
      "payTo": "0xYour...",
      "productId": "prod_research",
      "resource": "http://localhost:3000/research",
      "nonce": "…"
    }
  ]
}
```

### Paid route — step 2: pay USDC, then retry with `X-PAYMENT`

Pay `0.005 USDC` on `arc` to `payTo`, echoing the challenge `nonce`. Build the
proof and base64-encode it:

```jsonc
// PaymentProof
{
  "txHash": "0xabc123…",
  "from":   "0xYourWallet…",
  "amount": "0.005",
  "network": "arc",
  "nonce":  "<nonce from the 402 challenge>"
}
```

```bash
PROOF='{"txHash":"0xabc123","from":"0xYourWallet","amount":"0.005","network":"arc","nonce":"<nonce>"}'
HEADER=$(printf '%s' "$PROOF" | base64)

curl -s http://localhost:3000/research -H "X-PAYMENT: $HEADER"
```

On a verified payment you get the paid result:

```json
{
  "data": {
    "productId": "prod_research",
    "report": {
      "title": "Market research: USDC pay-per-call APIs",
      "summary": "This premium report was unlocked by a verified x402 USDC payment.",
      "generatedAt": "…",
      "findings": ["…"]
    }
  }
}
```

If verification fails (or is unconfigured), you get another `402` with a
`reason` explaining why — never a silent free pass.

---

## Manifest — `package.json`

```json
{
  "name": "settlekit-express-paid-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4"
  }
}
```

`@settlekit/x402` is consumed by relative path (see **Prerequisites**), so it is
not listed as an npm dependency here.
