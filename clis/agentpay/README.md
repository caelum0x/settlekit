# agentpay

A small, dependency-free Go CLI that lets an AI agent **discover** and **pay
for** [SettleKit](https://github.com/settlekit) agent services and
x402-protected APIs.

It speaks the SettleKit HTTP API (the `{data}` / `{error}` envelope) and the
[x402](https://www.x402.org/) "HTTP 402 pay-per-call" protocol end-to-end: call
a protected endpoint, parse the `402 Payment Required` challenge, attach an
`X-Payment` proof-of-payment, and retry to get the paid result.

> The CLI does **not** move funds itself — settling USDC on-chain is the agent's
> wallet's job. You supply the resulting transaction hash via `--tx-hash` and
> agentpay constructs and submits the proof.

## Build

Pure standard library, Go 1.22+:

```bash
cd clis/agentpay
go build ./...            # compile everything
go build -o agentpay .    # produce the ./agentpay binary
go test ./...             # run the test suite
```

## Configuration

Configuration comes from the environment:

| Variable             | Default                   | Purpose                                            |
| -------------------- | ------------------------- | -------------------------------------------------- |
| `SETTLEKIT_API_URL`  | `http://localhost:8787`   | Base URL of the SettleKit HTTP API.                |
| `SETTLEKIT_API_KEY`  | _(none)_                  | Bearer token sent as `Authorization: Bearer <key>` to authenticated SettleKit endpoints. |

```bash
export SETTLEKIT_API_URL="http://localhost:8787"
export SETTLEKIT_API_KEY="sk_..."   # bootstrap or org API key
```

## Commands

```text
agentpay <command> [flags]

  discover            list discoverable agent services + marketplace listings
  metadata <id>       fetch a service's agent-readable metadata.json
  call <url>          call a paid endpoint; pay a 402 challenge with --tx-hash
```

> Flags use the Go standard `flag` package, so **flags must precede the
> positional argument** (e.g. `agentpay call --tx-hash 0x.. <url>`).

### discover

Lists agent services (`GET /v1/agent-services`) and marketplace listings
(`GET /v1/marketplace/listings`) with their price, network, and endpoint.

```bash
agentpay discover
agentpay discover --tag base --max-price 0.01
agentpay discover --q summarize --sort price
```

| Flag          | Description                                                            |
| ------------- | --------------------------------------------------------------------- |
| `--tag`       | Filter listings by tag; for agent services filters by network.        |
| `--max-price` | Only show agent services priced at or below this decimal amount.      |
| `--sort`      | Marketplace sort: `top` \| `new` \| `price` (default `top`).          |
| `--q`         | Free-text search for marketplace listings.                            |

### metadata

Fetches the machine-readable `metadata.json` for a service
(`GET /v1/agent-services/:id/metadata.json`). This document is served as raw
JSON (not wrapped in the `{data}` envelope) and describes how an agent pays:

```bash
agentpay metadata svc_abc123
```

```json
{
  "name": "Summarizer",
  "description": "Summarize text",
  "price": "0.005",
  "currency": "USDC",
  "paymentProtocol": "x402",
  "network": "base",
  "endpoint": "https://svc.example.com/run",
  "inputSchema": { "text": "string" }
}
```

### call

Calls a paid endpoint. If it is paywalled, the server replies `402` with the
x402 `PaymentRequirements`; agentpay prints them. Supply `--tx-hash` (and
`--from`) to settle and retry in one shot.

```bash
# Discover the price (no payment yet)
agentpay call https://svc.example.com/run

# Settle USDC on-chain with your wallet, then pay + retry:
agentpay call \
  --tx-hash 0xabc123... \
  --from 0xYourWalletAddress \
  --body '{"text":"summarize me"}' \
  https://svc.example.com/run
```

| Flag              | Description                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| `--method`        | HTTP method (default `GET`).                                            |
| `--body`          | Request body (service input, usually JSON).                            |
| `--content-type`  | Body content type (default `application/json`).                        |
| `--tx-hash`       | On-chain settlement tx hash. Supplying it pays the 402 and retries.    |
| `--from`          | Wallet address that sent the payment (required with `--tx-hash`).      |
| `--amount`        | Amount paid; defaults to the challenge amount.                          |
| `--network`       | Settlement network; defaults to the challenge network.                 |
| `--nonce`         | Challenge nonce; defaults to the nonce from the 402 challenge.          |
| `--authorization` | `Authorization` header value forwarded to the protected endpoint.       |

## End-to-end agent flow

```text
1. discover            agentpay discover --max-price 0.01
                       → finds "Summarizer" [svc_abc] @ 0.005 USDC on base
                         endpoint: https://svc.example.com/run

2. metadata            agentpay metadata svc_abc
                       → reads inputSchema + payment details

3. call (probe)        agentpay call https://svc.example.com/run
                       → 402 Payment Required
                         amount:  0.005 USDC
                         payTo:   0xMerchant
                         network: base
                         nonce:   n_9f3a...

4. pay (off-CLI)       agent's wallet sends 0.005 USDC to 0xMerchant on base,
                       quoting nonce n_9f3a..., yielding tx 0xabc123...

5. call (paid)         agentpay call --tx-hash 0xabc123... --from 0xAgent \
                         --body '{"text":"..."}' https://svc.example.com/run
                       → X-Payment proof attached, server verifies on-chain,
                         returns HTTP 200 with the real result.
```

## How the x402 proof is constructed

On a `402`, the server advertises `PaymentRequirements`:

```json
{ "scheme": "x402", "amount": "0.005", "asset": "USDC", "network": "base",
  "payTo": "0x...", "productId": "p_1", "resource": "/run", "nonce": "n_9f3a" }
```

agentpay builds a `PaymentProof` from your `--tx-hash`/`--from` plus the
challenge's `amount`, `network`, and `nonce`:

```json
{ "txHash": "0xabc123", "from": "0xAgent", "amount": "0.005",
  "network": "base", "nonce": "n_9f3a" }
```

base64-encodes it into the `X-Payment` header, and retries the request. The
server verifies the on-chain transfer matches the challenge and returns the
real response.

## Layout

```text
clis/agentpay/
├── go.mod                          module github.com/settlekit/agentpay (go 1.22)
├── main.go                         entrypoint; routes subcommands
├── internal/
│   ├── client/client.go            SettleKit API client ({data}/{error}, Bearer auth)
│   ├── x402/x402.go                x402 call/challenge/retry + proof encode/decode
│   └── commands/                   discover / metadata / call subcommands
└── README.md
```
