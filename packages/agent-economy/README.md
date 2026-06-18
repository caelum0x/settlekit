# @settlekit/agent-economy

The closed-loop demo and traction harness for the Lepton entry.

N autonomous paying agents (`@settlekit/agent`) discover and pay citation tolls (`@settlekit/citation-toll`); the publisher settles recursive royalties to authors. A shared reputation store lets early agents' ratings inform later ones (emergent reputation). Returns a reconciled report — volume, platform fees, per-author earnings, per-agent spend — where `volume == author earnings + platform fees` exactly.

```bash
# Runnable demo (Claude when ANTHROPIC_API_KEY is set, else heuristic)
AGENTS=6 BUDGET=0.005 MAX_PRICE=0.001 MAX_PURCHASES=3 node dist/cli.js
```

```ts
import { runAgentEconomy, seedLeptonSources } from "@settlekit/agent-economy";

const report = await runAgentEconomy({
  sources: seedLeptonSources(),
  agentCount: 6,
  perAgentBudgetUsdc: "0.005",
  maxPriceUsdc: "0.001",
  maxPurchasesPerAgent: 3,
});
// report.totalPayments, report.totalVolumeUsdc, report.authorEarnings, report.perAgent
```

Also exposed live (no API key) at `GET /v1/lepton/economy/run` in `@settlekit/api`.
