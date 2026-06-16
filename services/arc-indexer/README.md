# SettleKit Arc Indexer

A small, production-grade Rust service that watches an **Arc / EVM** JSON-RPC
endpoint for **USDC ERC-20 `Transfer`** events sent to a configured payout
address, waits for a configurable number of block confirmations, and POSTs a
payment confirmation to the **SettleKit API**.

## How it works

Each poll cycle:

1. Fetch the chain head via `eth_blockNumber`.
2. Compute the *safe head* = `head - CONFIRMATIONS` (only fully confirmed blocks
   are processed).
3. Fetch logs via `eth_getLogs`, filtered by:
   - the USDC contract `address`,
   - `topics[0]` = the ERC-20 `Transfer(address,address,uint256)` signature hash
     (`0xddf252ad…`),
   - `topics[2]` = the watched recipient address (left-padded to 32 bytes),
   over the inclusive block range `(last_processed, safe_head]` (chunked to at
   most 2000 blocks per request when catching up).
4. Decode each log (`from`/`to` from topics, `value` from data) and POST it to
   the SettleKit **direct-payment** endpoint
   `POST {SETTLEKIT_API_URL}/v1/payments/observe` with a `Bearer` API key.
5. Advance an in-memory cursor.

Shutdown is graceful — `Ctrl-C` stops the loop cleanly.

### Observe request

The API **re-verifies the transfer on-chain** (it never trusts the indexer's
claim), screens the sender, and records a confirmed payment attributed to
`ORGANIZATION_ID`. The endpoint is idempotent on `txHash`. Request body:

```json
{
  "organizationId": "org_…",
  "txHash": "0x…",
  "to": "0x…watched address",
  "amount": "10.5",
  "asset": "USDC",
  "network": "arc",
  "from": "0x…sender",
  "confirmations": 5
}
```

`amount` is a decimal **major-unit** string (the indexer converts USDC base
units → major units). SettleKit replies with a `{ "data": … }` envelope on
success or `{ "error": { "code", "message", "details"? } }` (with the HTTP status
carrying the error) on failure — e.g. `validation_error` when on-chain
re-verification fails, or `compliance_blocked` when the sender is sanctioned.

## Configuration

All configuration comes from environment variables and is validated at startup.

| Variable              | Required | Default | Description                                            |
| --------------------- | -------- | ------- | ------------------------------------------------------ |
| `ARC_RPC_URL`         | yes      | —       | Arc/EVM JSON-RPC HTTP endpoint.                        |
| `ARC_USDC_ADDRESS`    | yes      | —       | USDC ERC-20 contract address (20-byte hex).            |
| `WATCH_ADDRESS`       | yes      | —       | Watched payout address (the Transfer `to`).            |
| `ORGANIZATION_ID`     | yes      | —       | Org that owns the watched address (payment attribution).|
| `SETTLEKIT_API_URL`   | yes      | —       | SettleKit API base URL (e.g. `http://localhost:8787`). |
| `SETTLEKIT_API_KEY`   | yes      | —       | Bearer API key for the SettleKit API.                  |
| `POLL_INTERVAL_SECS`  | no       | `12`    | Seconds between polls (must be > 0).                   |
| `CONFIRMATIONS`       | no       | `3`     | Confirmations required before reporting a transfer.    |
| `START_BLOCK`         | no       | head    | Block to start scanning from; defaults to chain head.  |

## Build & run

```bash
cd services/arc-indexer
cargo build --release

ARC_RPC_URL="https://rpc.arc.example/v1" \
ARC_USDC_ADDRESS="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" \
WATCH_ADDRESS="0x000000000000000000000000000000000000dEaD" \
SETTLEKIT_API_URL="http://localhost:8787" \
SETTLEKIT_API_KEY="sk_live_…" \
CONFIRMATIONS=3 POLL_INTERVAL_SECS=12 \
./target/release/arc-indexer
```

## Source layout

| File              | Responsibility                                                       |
| ----------------- | -------------------------------------------------------------------- |
| `src/main.rs`     | Tokio entrypoint, poll loop, cursor management, graceful shutdown.   |
| `src/config.rs`   | Environment loading + validation into an immutable `Config`.         |
| `src/rpc.rs`      | Minimal typed JSON-RPC client (`eth_blockNumber`, `eth_getLogs`).    |
| `src/usdc.rs`     | Transfer topic0 constant, address/topic padding, log decoding.       |
| `src/settlekit.rs`| SettleKit API client for posting payment confirmations.              |
| `src/error.rs`    | `thiserror`-based unified error type.                                |

## Notes

- The API key is never logged.
- Malformed logs and API rejections are logged and skipped; they never stall the
  indexer.
- The cursor is in-memory; on restart, set `START_BLOCK` to backfill from a known
  height (otherwise it resumes from the current chain head).
