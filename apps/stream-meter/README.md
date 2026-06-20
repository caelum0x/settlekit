# @settlekit/stream-meter

A live **per-second USDC streaming-payment meter** (Lepton RFB 4) built on the
real `@settlekit/streaming` domain logic. A viewer authorizes a *rate*
(USDC/second) and a *reserve* (the maximum to commit); value accrues in real
time as an Owncast broadcast or Navidrome listen is delivered, pauses the
instant delivery drops (proof-of-flow), and settles in gas-free checkpoints.

## Pages

- **Meter** (`/`) — SSR totals plus a live, ticking per-second meter that drives
  a real `PaymentStream` in the browser. Accrued / due / settled / refundable
  values come straight from `stream.snapshot()` — never a hand-rolled formula.
- **Streams** (`/streams`) — every active stream (Owncast broadcasts and
  Navidrome listens) with its parties, authorized rate, state, and accrued /
  settled / refundable balances.
- **Settlements** (`/settlements`) — the settlement checkpoints captured as each
  stream batched its accrued-but-unsettled value.

## Domain logic, not mocked JSON

`lib/data.ts` builds every stream with `openStream()` from `@settlekit/streaming`
over a **fixed millisecond clock**, advancing a cursor in steps and calling
`reportFlow()` / `settle()` exactly as a live integration would. The fixed clock
makes server rendering and `next build` deterministic. The browser meter
(`components/LiveMeter.tsx`, `"use client"`) builds the **same** real
`PaymentStream` via `buildLiveStream(() => Date.now())` so the on-screen ticker
is the genuine accrual function, not a re-implementation.

Swap `lib/data.ts` for a `StreamStore`-backed loader (e.g. a Postgres
`StreamStore`) to go live.

## Develop

```bash
pnpm --filter @settlekit/stream-meter dev    # http://localhost:3009
```

## Build

`@settlekit/streaming` and `@settlekit/common` are consumed as compiled ESM
(`dist/`), so they must be built first. The `...` selector handles that:

```bash
pnpm --filter @settlekit/stream-meter... build
# or build the whole workspace: pnpm -r build
```

Port: **3009**.
