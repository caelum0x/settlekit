# rsshub-citation-toll

The first real-world traction sidecar for the Lepton build (RFB 6 + 3): attach **per-citation tolls** to content from an existing community (RSSHub) without forking it. Agents that ground answers in a source pay a sub-cent toll; the proceeds settle as **recursive royalties** to the source authors through the production settlement spine.

## Flow

```
RSS items ──ingest──▶ citation-toll Sources (author → wallet via payee-registry)
                          │
agent ──pay x402 toll──▶ GET /articles/:id ──royalty split──▶ pending royalty legs
                                                                  │
settlement worker / POST /admin/sweep ──batch per wallet──▶ settlement-core ──▶ author payouts on Arc
```

The settlement is **real and configurable** — `@settlekit/settlement-core` (Gateway batched nanopayments or Circle wallets); the in-process local provider is for demos/tests only. x402 payments are verified on-chain via the Arc indexer when `ARC_INDEXER_URL` is set, otherwise a local pair is used for local runs.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | overview (source count, verification mode) |
| `GET` | `/health` | liveness |
| `POST` | `/admin/feeds` | ingest RSS items: `{ items: RssItem[] }` |
| `GET`/`*` | `/articles/:id` | x402-gated citation content (402 until paid) |
| `POST` | `/admin/sweep` | batch + settle pending royalties to authors |

## Run

```bash
pnpm --filter @settlekit/rsshub-citation-toll build
PORT=8790 ESCROW_WALLET=0x... node services/sidecars/rsshub-citation-toll/dist/server.js
```

Env: `PORT`, `ORG_ID`, `DEFAULT_TOLL_USDC`, `NETWORK`, `ESCROW_WALLET`, `ARC_INDEXER_URL` (enables on-chain verification).

## Wiring to a live RSSHub

`createRssIngestor` is the seam: point a fetcher at an RSSHub feed's JSON, map each entry to an `RssItem` (feed id, item id, title, author identity, content), and call `ingestMany`. Authors are resolved to payout wallets via `@settlekit/payee-registry`; unregistered authors accrue to the escrow wallet until they claim it.
