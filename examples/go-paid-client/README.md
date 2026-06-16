# Go x402 Paid-API Client

A runnable, dependency-free Go CLI that calls a **SettleKit** x402 "pay-per-call"
endpoint, handles the HTTP `402 Payment Required` challenge, constructs a payment
proof, and retries with the `X-PAYMENT` header to retrieve the paid result.

It implements the client side of the [`@settlekit/x402`](../../packages/x402)
wire contract:

1. `GET` the protected resource with no payment.
2. Server replies **HTTP 402** with body
   `{"error":"payment_required","accepts":[<PaymentRequirements>]}`.
3. Client reads `accepts[0]`, settles the owed USDC on-chain (out of band), then
   builds a `PaymentProof {txHash, from, amount, network, nonce}` — echoing the
   challenge `nonce` verbatim so the server can bind the proof to this challenge.
4. The proof is JSON-serialized, **base64-encoded**, and sent as the `X-PAYMENT`
   header on a retry `GET`, which returns the paid payload.

> This client does **not** perform the on-chain USDC transfer. You settle the
> payment with your own wallet/agent, then pass the resulting `--tx-hash` (and
> `--from`) — exactly how a real agent presents its receipt.

## Requirements

- Go 1.22+ (standard library only — no third-party modules).

## Build

```bash
cd examples/go-paid-client
go build -o paidclient .
```

## Flags

| Flag         | Default                                        | Description                                                         |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| `--url`      | `http://localhost:8787/v1/paid/research`       | SettleKit paid endpoint to call.                                    |
| `--tx-hash`  | _(empty)_                                      | On-chain tx hash of the USDC payment. When set, the client pays and retries. |
| `--from`     | _(empty)_                                      | Address that sent the payment (included in the proof).              |
| `--network`  | `arc`                                          | Settlement network claimed in the payment proof.                    |

### Environment

- `SETTLEKIT_API_KEY` — optional. When set, sent as `Authorization: Bearer <key>`
  so the example also works against deployments that gate the endpoint behind
  bearer auth.

## End-to-End Walkthrough

### 1. Start the SettleKit API

From the repository root, run the API (default base `http://localhost:8787`):

```bash
pnpm install
pnpm --filter @settlekit/api dev
```

The public paid endpoint is `GET /v1/paid/research` (price **0.005 USDC**,
network `arc`). On-chain settlement is verified by the Arc verifier; set
`ARC_RPC_URL` (and `X402_PAY_TO` for the destination address) in the API's
environment to enable real verification.

### 2. Discover the price (GET → 402)

Run the client with no `--tx-hash`. It performs the unpaid GET, receives the
402 challenge, and prints the requirements:

```bash
./paidclient --url http://localhost:8787/v1/paid/research
```

```
402 Payment Required — payment requirements:
  scheme    : x402
  amount    : 0.005 USDC
  network   : arc
  payTo     : 0x0000000000000000000000000000000000000000
  productId : prod_x402_research
  resource  : http://localhost:8787/v1/paid/research
  nonce     : 9f1c0b...

Pay 0.005 USDC on arc to 0x0000... , then re-run with --tx-hash (and --from) to retrieve the result.
```

### 3. Pay, then retrieve (GET → pay → 200)

Settle `0.005 USDC` on `arc` to the `payTo` address shown above using your
wallet/agent. Then re-run with the resulting transaction hash and sender:

```bash
./paidclient \
  --url http://localhost:8787/v1/paid/research \
  --tx-hash 0xYOUR_SETTLED_TX_HASH \
  --from   0xYOUR_PAYER_ADDRESS \
  --network arc
```

The client re-fetches the 402 (to capture the current `nonce`), builds the
proof, base64-encodes it into the `X-PAYMENT` header, retries, and prints the
paid result:

```
Paying with X-PAYMENT header (proof for tx 0xYOUR_SETTLED_TX_HASH)...

200 OK — paid result:
{
  "data": {
    "answer": "Paid research result: USDC settles on Arc in seconds.",
    "generatedAt": "2026-06-16T12:00:00.000Z"
  }
}
```

If the proof cannot be verified on-chain (for example, the API has no
`ARC_RPC_URL` configured, or the transfer has not settled), the server honestly
rejects the retry. The client prints the server's reason and exits non-zero:

```
payment not accepted (status 402):
{
  "error": "payment_required",
  "accepts": [],
  "reason": "x402 settlement requires Arc (set ARC_RPC_URL)"
}
error: paid retry returned status 402
```

## How the proof is encoded

The `X-PAYMENT` header is base64-encoded JSON, matching
`@settlekit/x402`'s `encodePaymentHeader`:

```jsonc
// JSON before base64-encoding
{
  "txHash":  "0x...",
  "from":    "0x...",
  "amount":  "0.005",   // echoed from requirements
  "network": "arc",
  "nonce":   "9f1c0b..." // echoed verbatim from requirements
}
```

## Files

| File          | Purpose                                                            |
| ------------- | ----------------------------------------------------------------- |
| `go.mod`      | Module manifest (`github.com/settlekit/examples/go-paid-client`). |
| `main.go`     | The CLI: flags, 402 parsing, proof building, base64, retry.       |
| `README.md`   | This document.                                                    |
