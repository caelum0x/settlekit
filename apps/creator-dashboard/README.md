# SettleKit Creator Dashboard

A Next.js 14 (App Router) earnings view for creators who get paid per-citation,
per-listen, or per-second of streamed reuse (Lepton). Rendered in the "Statement"
greenbar-ledger design system.

## Driven by real domain logic, not mocks

`lib/data.ts` is the data layer and it drives the actual settlement spine, so the
UI shows exactly what production would produce:

- sources are built with `@settlekit/citation-toll` `createSource`, including real
  citation edges between works;
- every simulated paid access runs through `computeRoyaltyDistribution` — the same
  recursive split the toll handler uses — so a creator earns from their own work
  *and* from the recursive share of everything that cites it;
- the attribution panel runs `@settlekit/attribution` `detectReuse` over the
  sources and issues a real signed proof-of-citation.

A fixed clock + fixed access counts keep the dataset deterministic across renders.
Swap this module for the Postgres-backed stores (`@settlekit/persistence`) to go live.

## Sections

- **Earnings** — Statement (`/`), Sources (`/sources`), Payouts (`/payouts`)
- **Attribution** — Reuse & proofs (`/attribution`, interactive)
- **Account** — Wallet (`/settings/wallet`)

## Develop

```bash
pnpm install
pnpm --filter @settlekit/creator-dashboard dev
# http://localhost:3007
```

## Build

```bash
pnpm --filter @settlekit/creator-dashboard build
```
