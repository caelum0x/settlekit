# SettleKit — Agent Console

The **Agentic + Innovation** surface: a window into autonomous agents doing
commerce. It shows agents discovering published **agent-services**, paying for
each call via **x402**, citing the sources they were grounded in, and presenting
signed **proofs-of-citation**.

## Real domain logic, not mocked JSON

`lib/data.ts` is deterministic but **drives the real SettleKit spine** — it never
ships hand-written JSON:

- **Marketplace** — listings are built with `createAgentService(...)`
  (`@settlekit/agent-services`), published with `publishAgentService`, and
  surfaced through `discoverPublishedAgentServices` / `discoverAgentServices`.
  The agent-readable `§11` metadata (`generateAgentMetadata`) is what an agent
  reads to pay via x402.
- **x402 spend** — each simulated agent invocation runs through
  `recordAgentUsage` / `agentUsageCost`; per-agent and per-service totals are
  aggregated with `addMoney` (`@settlekit/common`).
- **Reputation** — star ratings are folded with `aggregateAgentReputation`
  (`ratingAverage`).
- **Citation toll** — sources are created with `createSource`
  (`@settlekit/citation-toll`) into an `InMemorySourceRegistry`, and
  `computeRoyaltyDistribution` produces the recursive royalty fan-out (depth-0
  author leg + depth>0 citation legs).
- **Attribution** — `detectReuse` (`@settlekit/attribution`) finds the sources an
  agent's answer was grounded in, and `issueCitationProof` mints a real,
  HMAC-signed, expiring proof.

A fixed clock (`2026-06-18T09:00:00Z`) plus fixed integer counts make every
Money total, royalty leg, reputation average, and reuse score byte-stable across
renders. (The proof `nonce`/`signature` use `randomUUID`, so they are the only
non-deterministic fields — by design.) Swap this module for the Pg-backed stores
to go live.

## Pages

| Route        | Surface                                                            |
| ------------ | ----------------------------------------------------------------- |
| `/`          | Console overview — agents, services, x402 spend, citations, proofs |
| `/agents`    | Autonomous agents — budget cap, requests, USDC spent, proofs       |
| `/services`  | Discovered agent-services — price, network, reputation, x402 meta  |
| `/citations` | Worked example — reuse detection, recursive toll, proof-of-citation |

## Develop

```bash
pnpm --filter @settlekit/agent-services... build   # build domain deps' dist/
pnpm --filter @settlekit/agent-console dev          # http://localhost:3008
```

## Config

- `CITATION_PROOF_SECRET` — HMAC secret for proof signing (dev fallback provided).
- `NEXT_PUBLIC_API_URL` — live API base (default `http://localhost:8787`).
