# SettleKit × Lepton — nanopayments on Arc

SettleKit's entry for the **Lepton Agents Hackathon** (Canteen × Circle × Arc). Built on top of SettleKit's existing settlement platform — three new modules turn it into a self-running, agent-native nanopayment economy where value too small to have been worth moving before clears in test USDC.

> The lepton was the smallest coin of the Greek world. Nanopayments are the lepton reborn for machines: value as small as $0.000001, settled per call, per access, per second.

## TL;DR — run it

```bash
pnpm install && pnpm build

# 1. The closed-loop economy in your terminal (autonomous agents pay citation tolls)
AGENTS=6 node packages/agent-economy/dist/cli.js

# 2. The same, live over HTTP (no API key, in-memory settlement)
PORT=8799 node apps/api/dist/server.js
curl "localhost:8799/v1/lepton/economy/run?agents=6"
curl "localhost:8799/v1/lepton/stream/demo?rate=0.001&reserve=0.01&seconds=6"
curl -i "localhost:8799/v1/lepton/articles/<id>"   # a real x402 402 challenge

# Set ANTHROPIC_API_KEY to run the agents with Claude (claude-opus-4-8) instead of the heuristic engine.
```

## The three modules

| Module | What it is | RFB |
|---|---|---|
| **`@settlekit/agent`** | An **autonomous paying agent**. A Claude (`claude-opus-4-8`) tool-use loop discovers x402-priced services, decides which to pay for under a hard spend policy, settles the toll, consumes the result, and rates the service. Every guardrail (total budget, per-call cap, reputation floor) is enforced in code, so the model's agency can't exceed policy. | 1, 3 |
| **`@settlekit/citation-toll`** | A **publisher** that prices content per access (x402) and settles **recursive royalty splits** down the citation lineage — a remix of a remix pays every ancestor, a shared ancestor is paid from each path. Money is conserved exactly at sub-cent amounts. | 6, 3 |
| **`@settlekit/streaming`** | **Per-second** continuous-authorization settlement (the explicit x402 "code gap"). Authorize a rate + reserve; value accrues by elapsed time, settles in batches, pauses instantly on a delivery drop (proof-of-flow), and refunds the reserved-but-unused remainder on stop. | 4 |

Plumbing: **`@settlekit/x402-client`** (the client-side pay-and-retry loop + a pluggable settler: a local ledger for runnable demos, or Circle programmable wallets for real testnet USDC) and **`@settlekit/agent-economy`** (the closed-loop harness + CLI).

## The closed loop (how traction is self-generated)

Autonomous agents (`@settlekit/agent`) are the buyers; citation-toll endpoints are the sellers; SettleKit clears every payment on Arc. Point N agents at the marketplace and the economy runs itself — real test-USDC volume with no users to recruit on a two-week clock:

```
agents ──discover──▶ marketplace listings
   │                      │
   └──pay x402 toll──▶ citation-toll endpoint ──recursive royalty split──▶ author wallets
                          (settled on Arc; platform take-rate applied)
```

A 6-agent run settles 18 payments for 0.0126 USDC, with royalties flowing recursively to authors — the root source earns the most because everything downstream cites it. Books reconcile exactly: `volume == author earnings + platform fees`.

## How it maps to judging

- **Agentic sophistication** — Claude decides the trajectory turn by turn via the official Anthropic SDK tool runner; the heuristic engine is only the offline/CI fallback.
- **Traction** — the agent↔publisher economy generates genuine settled volume autonomously; every run is reconciled.
- **Circle tooling** — built on SettleKit's existing Gateway (nanopayments), x402, Paymaster, Circle wallets, and Arc client; the settler plugs into Circle programmable wallets for real testnet USDC.
- **Innovation** — recursive citation royalties and per-second streaming settlement are both new ground.

## Tests

Every module ships unit + closed-loop tests (`pnpm test`). The new modules cover the full pay → verify → settle → reconcile path with no network or API key required.
