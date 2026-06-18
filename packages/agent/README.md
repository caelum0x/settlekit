# @settlekit/agent

An autonomous paying agent for nanopayment marketplaces (Lepton RFB 1 & 3).

It discovers x402-priced services, decides which are worth paying for under a hard spend policy, settles the toll via `@settlekit/x402-client`, consumes the result, and rates the service. The decision engine is pluggable:

- **`ClaudeDecisionEngine`** — the real brain. Exposes the capability surface as tools to Claude (`claude-opus-4-8`) through the official Anthropic SDK tool runner; the model drives the trajectory. Requires `ANTHROPIC_API_KEY`.
- **`HeuristicDecisionEngine`** — deterministic fallback for offline runs, CI, and the closed-loop harness.

Every spend guardrail (total budget, per-call cap, reputation floor, purchase limit) is enforced inside the capability layer, so no engine can exceed the policy regardless of what it decides.

```ts
import { PayingAgent, ClaudeDecisionEngine } from "@settlekit/agent";

const agent = new PayingAgent({
  services, reputation, fetcher, settler, from: "0xagent",
  policy: { totalBudgetUsdc: "0.01", maxPriceUsdc: "0.002", maxPurchases: 5, minReputation: 3 },
});

const result = await agent.run(
  { objective: "Gather grounded sources on Arc settlement within budget." },
  new ClaudeDecisionEngine(), // or omit to auto-pick by ANTHROPIC_API_KEY
);
// result.purchases, result.totalSpent, result.remaining, result.log
```
