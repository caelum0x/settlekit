# Lepton — Production Build Plan

This plan takes the Lepton modules from runnable demos to **real production software**: payments that settle on Arc in real (testnet, then main) USDC, persisted state, and **real traction** by attaching to open-source creator communities that already have audiences. It reuses SettleKit's existing rails (`gateway`, `circle-wallets`, `paymaster`, `arc`, `x402`, `payouts`, `platform-billing`, `persistence`, `database`, `webhooks`, `compliance`, `arc-indexer`) rather than re-inventing them.

## Principles

1. **Real settlement, not a ledger.** The in-memory `LocalLedger` becomes a fallback for tests only. Production settles via **Gateway nanopayments** (batched, gas-free) and **Circle programmable wallets**, verified on-chain by the **arc-indexer**.
2. **Everything persisted.** Every new domain (sources, citations, royalty legs, streams, agent runs, wallet fleet, reputation) gets a Postgres-backed store following the repo's dual Pg/in-memory + doc-projection pattern.
3. **Idempotent + reconciled.** Every payment path carries an idempotency key and is reconciled against chain state by a worker job. No double-spend, no lost settlement.
4. **Traction from existing communities.** Standalone **sidecars** attach to Navidrome, Owncast, Jellyfin, and RSSHub from the outside (their webhooks/APIs) — real per-listen, per-second, per-view, per-citation payments to real creators.
5. **Creators can cash out.** Real-world payout rails (Circle Payments Network off-ramp) so a creator's USDC earnings become local currency.

---

## Phase 1 status (built)

Done and green: **`@settlekit/settlement-core`** (configurable Gateway/Circle/local providers, idempotency, batch accumulator, on-chain reconciliation, nonce store, in-memory + queryable receipt stores), **`@settlekit/wallet-fleet`** (registry, spending caps + kill-switch, balances, Circle provisioning), **`@settlekit/x402-client`** extended (provider-settler adapter + Arc-indexer on-chain verifier), **`@settlekit/citation-toll`** domain stores (`SourceStore`, `RoyaltyLegStore`, `loadSourceRegistry`), the **`lepton` DB schema** (12 tables, wired into the drizzle schema object), **persistence** (`PgIdempotencyStore`/`PgNonceStore` for durable settlement, `PgSourceStore`, `PgRoyaltyLegStore`, `PgWalletRegistry`), and the **`apps/worker` `lepton-settlement-reconcile` job** (no-ops until the spine is wired). The Go `services/x402-gateway` facilitator already exists.

Also done: **`@settlekit/streaming`** `StreamStore` (+ `PgStreamStore`), royalty-leg `markSettled` + `network`, and the worker jobs **`lepton-payout-sweep`** (batches pending royalty legs per wallet → one settlement each, marks legs settled) and **`lepton-stream-refund`** (refunds stopped streams' unused reserve, idempotent). The `lepton-settlement-batch` job is subsumed by the payout sweep, which batches inherently. All three Lepton worker jobs are wired into `JobContext` / `runtime` / scheduler and no-op until a `settlementProvider` + Arc-indexer `confirmationSource` are injected on the deployment.

**Phase 1 is functionally complete.** Deferred (build when a consumer exists): the agent-run Pg-store (persistence-only, no job yet).

## Phase 2 status (in progress)

Done and green: **`@settlekit/payee-registry`** (identity→wallet mapping, in-memory + `PgPayeeRegistry`), the shared **`sweepPendingRoyalties`** (one money-path implementation, used by the worker job and the sidecar), and the first real-traction sidecar **`services/sidecars/rsshub-citation-toll`** — ingests RSS items as priced citeable sources (author→wallet via the payee registry), gates them behind x402, records per-citation royalty legs, and settles them to authors through `settlement-core`. The demo modules are flipped onto the settlement spine. `services/sidecars/*` is now a TS workspace area (pnpm + vitest wired). Booted live: ingest → 402 challenge → sweep all verified over HTTP.

Next in Phase 2: point the ingestor at a live RSSHub instance (real feeds → real authors), wire the sidecar's settlement provider to Gateway/Circle on Arc testnet with the Arc-indexer verifier, and add the Navidrome per-listen sidecar (Phase 3).

## Directory map (new work, by top-level folder)

### `packages/` — domain logic (pure, persisted, tested)

```
packages/
  settlement-core/                  # the production settlement engine behind every module
    src/
      settler.ts                    # Settler interface (prod): Gateway | CircleWallet | (test) Local
      gateway-settler.ts            # batched nanopayment settlement via @settlekit/gateway
      onchain-verifier.ts           # x402 PaymentVerifier backed by arc-indexer confirmations
      nonce-store.ts                # issued-nonce tracking for stateless replay protection
      idempotency.ts                # idempotency-key helpers for all settlement calls
      settlement-batch.ts           # accrue → batch → submit → confirm lifecycle
      types.ts  index.ts
    test/
  wallet-fleet/                     # RFB 5 — manage many agent + creator wallets
    src/
      wallet-registry.ts            # entity (agent|creator|author) -> wallet mapping + store
      provisioning.ts               # create/import wallets via @settlekit/circle-wallets
      spending-caps.ts              # per-wallet/per-day caps, allowances, kill-switch
      balances.ts                   # unified balances via App Kit / gateway
      types.ts  store.ts  pg-store.ts  index.ts
    test/
  payee-registry/                   # MusicBrainz/immich/credits -> wallet, the payout RULE
    src/
      payee.ts                      # payee identity (MBID, ISNI, immich author, handle)
      registry.ts  store.ts  pg-store.ts
      attribution-import.ts         # ingest beets/Picard/immich credit graphs
      split-resolver.ts             # turn an attribution graph into RoyaltySplit edges
      types.ts  index.ts
    test/
  attribution/                      # reuse detection + provenance for citation tolls (RFB 6.01)
    src/
      lineage-graph.ts              # recursive citation/remix graph (prod store-backed)
      reuse-detector.ts             # detect when an answer/feed is grounded in a source
      proof.ts                      # signed proof-of-citation an agent presents
      types.ts  store.ts  pg-store.ts  index.ts
    test/
```

Existing demo packages are **promoted** (not replaced) to production:

```
packages/
  citation-toll/                    # ADD: pg-store.ts, on-chain settle path, persist royalty legs
    src/ store.ts  pg-store.ts  royalty-ledger.ts  settle.ts   # legs -> payouts via settlement-core
  streaming/                        # ADD: persistence + on-chain batched settle + surge pricing
    src/ stream-store.ts  pg-store.ts  gateway-batcher.ts  surge.ts  reconcile.ts
  agent/                            # ADD: durable run log, ERC-8004 reputation, real wallet binding
    src/ run-store.ts  pg-store.ts  reputation-onchain.ts
  agent-economy/                    # KEEP as the simulator/load-test harness (RFB 5 tooling)
```

New schema + persistence:

```
packages/database/src/schema/
  lepton.ts                         # tables: sources, citations, royalty_legs, streams,
                                    # stream_settlements, agent_runs, agent_purchases,
                                    # wallets, payees, payee_splits, settlement_batches, nonces
packages/persistence/src/
  citation-toll-store.ts  streaming-store.ts  wallet-fleet-store.ts
  payee-registry-store.ts  agent-run-store.ts  settlement-batch-store.ts
  codec additions for each (doc-projection)
```

### `services/` — long-running processes (sidecars + settlement infra)

```
services/
  x402-gateway/                     # ALREADY EXISTS (Go) — production x402 facilitator /
                                    # reverse-proxy (402 challenge + proof verification). Keep;
                                    # extend its verifier to call the Arc indexer for confirmations.
  # Settlement jobs run in the existing Node apps/worker (not a new service):
  #   apps/worker/src/jobs/
  #     lepton-settlement-batch-job.ts   # flush BatchAccumulator via settlement-core on interval
  #     lepton-settlement-reconcile-job.ts # reconcileReceipts() vs arc-indexer confirmations
  #     lepton-stream-refund-job.ts      # streaming reserved-but-unused auto-refunds
  #     lepton-payout-sweep-job.ts       # roll author balances into payouts / CPN off-ramp
  arc-indexer/                      # ALREADY EXISTS (Rust) -> EXTEND
    src/ settlement.rs (extend)     # emit confirmations the verifier/worker consume
  sidecars/                         # REAL TRACTION — attach to existing communities
    navidrome-scrobble/             # RFB 6.05 per-listen royalties (Subsonic/Navidrome)
      src/ poller.ts  play-gate.ts  mbid-resolver.ts  settle.ts  config.ts  server.ts
    owncast-stream/                 # RFB 4.06 per-second live streaming
      src/ webhook.ts  session-meter.ts  surge.ts  split.ts  server.ts
    jellyfin-vod/                   # per-minute VOD settlement
      src/ playback-webhook.ts  session-meter.ts  rights-holder-split.ts  server.ts
    rsshub-citation-toll/           # RFB 6.01 per-citation tolls at the agent boundary
      src/ middleware.ts  toll.ts  attribution.ts  server.ts
  webhook-relay/                    # EXISTS — reuse for outbound creator/settlement webhooks
```

Each sidecar is a self-contained deployable: reads the community's events (Subsonic API poll, Owncast/Jellyfin webhooks, RSSHub middleware), maps the work to a payee via `payee-registry`, settles via `settlement-core`, and exposes `/health` + `/metrics`. They run **outside** the host project — no fork required.

### `apps/` — product surfaces (real users click these)

```
apps/
  creator-dashboard/                # Next.js — creators see earnings, set wallet, cash out
    app/ earnings/  sources/  payouts/  settings/wallet/
  agent-console/                    # Next.js — operate the agent fleet (RFB 5)
    app/ agents/  budgets/  runs/  reputation/
  stream-meter/                     # Next.js — live per-second meter UI for viewers/streamers
    app/ watch/[id]/  studio/
  api/                              # EXISTING — promote /v1/lepton to real authed resources:
    src/routes/
      sources.ts  citations.ts  royalties.ts        # citation-toll CRUD + settlement
      streams.ts                                     # open/pause/stop/settle streams
      wallets.ts  payees.ts                          # fleet + payee registry
      agents.ts                                      # launch/inspect agent runs
      facilitator.ts                                 # thin proxy to services/x402-gateway
    (keep /v1/lepton as the public unauthenticated showcase)
```

### `contracts/` — on-chain primitives on Arc

```
contracts/
  src/
    LeptonStreamSettlement.sol      # on-chain per-second stream w/ reserve + proof-of-flow pause
    RecursiveSplitDistributor.sol   # pay a lineage graph in one tx (royalties that follow a work)
    AgentReputationBond.sol         # ERC-8004 reputation: USDC bond, auto-slash on bad outcome
    CitationToll.sol                # on-chain toll receipts + per-citation settlement
  test/  script/ (Deploy*.s.sol)
```

### `clis/` — operator + creator tooling

```
clis/
  agentpay/                         # EXISTS (Go) — extend: budget, discover, call, reputation
  lepton/                           # NEW operator CLI (TS): run sidecars, settle, reconcile, faucet
    src/ commands/ {sidecar,settle,reconcile,wallet,payee,economy,faucet}.ts
  creator/                          # NEW creator CLI: register wallet, claim earnings, cash out
```

### `sdks/` — client libraries for the new surfaces

```
sdks/
  ts/ (or packages/sdk) lepton/     # x402 payer, citation-toll client, streaming client, payee
  python/settlekit/lepton/          # paying-agent + sidecar helpers (matches Circle/LangChain ref)
  rust/src/lepton/                  # high-perf payer for the scrobble/stream sidecars
  go/lepton/                        # aligns with the Go agentpay CLI
```

---

## Settlement hardening (the core of "real")

1. **Gateway batching** — accrued nano-amounts (per-listen, per-second, per-citation) buffer into `settlement_batches` and flush via `@settlekit/gateway` burn intents → one gasless settlement for thousands of leptons.
2. **On-chain verification** — `services/x402-gateway` verifies proofs via `onchain-verifier` (arc-indexer confirmations), not by trusting the client. Stateless replay protection via `nonce-store`.
3. **Idempotency end-to-end** — every `createTransfer` / batch carries a deterministic key (already added to the Circle settler); the `reconcile-job` is the source of truth.
4. **Refunds + proof-of-flow** — `refund-job` returns streaming reserves; meters pause on delivery drop (already in `@settlekit/streaming`), enforced on-chain by `LeptonStreamSettlement.sol`.
5. **Creator cash-out** — `payout-sweep-job` rolls author USDC balances into `@settlekit/payouts`, with an optional **Circle Payments Network** off-ramp module (`packages/payouts-cpn/`) for fiat (e.g. USDC→MXN/SPEI) so real creators get paid in their currency.

---

## Phased rollout

- **Phase 1 — Real settlement spine.** `settlement-core`, `wallet-fleet`, `services/x402-gateway`, `settlement-worker`, DB schema. Flip citation-toll + streaming + agent off the local ledger onto Gateway/Circle on Arc testnet.
- **Phase 2 — First real traction.** Ship **one** sidecar end-to-end (recommend `rsshub-citation-toll` — agents are the payers, so volume is self-generating and immediate) + `payee-registry`. Real test-USDC flowing to real source authors.
- **Phase 3 — Creator products.** `navidrome-scrobble` + `owncast-stream` sidecars, `creator-dashboard`, cash-out (`payouts-cpn`). Onboard real self-hosted instances.
- **Phase 4 — Onchain + reputation.** Deploy `contracts/`, move splits/streams/bonds on-chain, ERC-8004 agent reputation, `agent-console`.

---

## Open decisions (need your call before Phase 1)

- **Settlement default:** Gateway batched nanopayments vs. direct Circle wallet transfers as the primary path (Gateway for true sub-cent economics; Circle for simplicity). Recommend Gateway primary, Circle fallback.
- **First sidecar:** RSSHub citation-toll (fastest real volume) vs. Navidrome per-listen (clearest creator story). Recommend RSSHub first, Navidrome second.
- **Fiat off-ramp now or later:** include `payouts-cpn` in Phase 3 or defer.
- **Contracts vs. off-chain ledger:** how much settlement logic goes on-chain in Phase 4 vs. staying in `settlement-core`.
