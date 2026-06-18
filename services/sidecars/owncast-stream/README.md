# owncast-stream

Per-second streaming payments for live media (Owncast / PeerTube) — RFB 4. A viewer pays for the **rate of flow, by the second**; leave at any moment and you've paid for exactly the time you were present, while the streamer's revenue accrues in real time.

## Flow

```
viewer joins ──▶ POST /sessions/join ──▶ open per-second PaymentStream (rate + reserve)
   │  (meter accrues while watching; pauses on a delivery drop — proof-of-flow)
viewer leaves ──▶ POST /sessions/leave ──▶ close stream
        │  watched time → pending royalty leg to the streamer
        │  reserved-but-unused remainder → reported as refund
        ▼
POST /admin/sweep (worker in prod) ──batch──▶ settlement-core ──▶ streamer payouts on Arc
```

Built on `@settlekit/streaming` (the meter), with `@settlekit/payee-registry` (streamer→wallet), `@settlekit/citation-toll` royalty legs + `sweepPendingRoyalties`, and `@settlekit/settlement-core` settlement.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | overview (rate, reserve, active sessions) |
| `GET` | `/health` | liveness |
| `POST` | `/sessions/join` | start metering `{ sessionId, streamer }` |
| `POST` | `/sessions/leave` | stop + settle watched time `{ sessionId }` |
| `POST` | `/admin/sweep` | batch + settle accrued streamer royalties |

## Run

```bash
pnpm --filter @settlekit/owncast-stream build
PER_SECOND_USDC=0.0001 RESERVE_USDC=0.05 node services/sidecars/owncast-stream/dist/server.js
```

Env: `PORT`, `ORG_ID`, `NETWORK`, `PER_SECOND_USDC`, `RESERVE_USDC`, `ESCROW_WALLET`.

## Wiring to a live Owncast

Owncast emits webhooks for stream and chat-user activity; derive per-viewer join/leave from them and call `/sessions/join` and `/sessions/leave`. The settlement provider is injectable (`createSidecar(config, { settlementProvider })`) — wire it to Gateway or Circle on Arc to settle real testnet USDC.
