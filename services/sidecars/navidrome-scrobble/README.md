# navidrome-scrobble

Per-listen royalties for self-hosted music servers (Navidrome / Subsonic) — RFB 6.05. Your money goes to the artists you **actually played**, settled per listen on Arc, instead of pooled pro-rata to whoever is globally popular.

## Flow

```
play event (scrobble) ──▶ POST /scrobble
   │  play-gating: a skip in the first N seconds is free
   │  per-listener daily cap (wallet-fleet)
   ▼
artist → wallet (payee-registry) ──▶ pending royalty leg (per-listen rate)
                                          │
POST /admin/sweep (worker in prod) ──batch per artist──▶ settlement-core ──▶ artist payouts on Arc
```

Reuses the production spine: `@settlekit/payee-registry` (artist→wallet), `@settlekit/citation-toll` royalty legs + `sweepPendingRoyalties`, `@settlekit/wallet-fleet` spending caps, `@settlekit/settlement-core` settlement.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | overview (rate, gate, pending legs) |
| `GET` | `/health` | liveness |
| `POST` | `/admin/artists` | register an artist payout wallet `{ externalId, wallet, displayName? }` |
| `POST` | `/scrobble` | ingest a play `{ userId, trackId, artist, playedSeconds }` |
| `POST` | `/admin/sweep` | batch + settle accrued royalties to artists |

## Run

```bash
pnpm --filter @settlekit/navidrome-scrobble build
PER_LISTEN_USDC=0.0002 MIN_PLAY_SECONDS=30 node services/sidecars/navidrome-scrobble/dist/server.js
```

Env: `PORT`, `ORG_ID`, `NETWORK`, `PER_LISTEN_USDC`, `MIN_PLAY_SECONDS`, `PER_USER_DAILY_CAP_USDC`, `ESCROW_WALLET`.

## Wiring to a live Navidrome

Navidrome/Subsonic servers keep an honest, complete play history and expose a scrobble API. A thin poller maps each play to a `ScrobbleEvent` (listener id, track, artist identity, played seconds) and POSTs `/scrobble`. Artists are resolved to wallets via the payee registry (MusicBrainz MBID is the natural key); unregistered artists accrue to escrow until claimed.
