/**
 * The paying agent: binds a marketplace, reputation store, payer, and spend
 * policy, then runs a goal through a decision engine and reports what it did.
 */

import type { Money } from "@settlekit/common";
import type { AgentReputationStore, AgentService } from "@settlekit/agent-services";
import type { RequestFetcher, Settler } from "@settlekit/x402-client";
import { AgentSession } from "./capabilities.js";
import { ClaudeDecisionEngine } from "./claude-engine.js";
import { HeuristicDecisionEngine } from "./heuristic-engine.js";
import type { AgentGoal, AgentRunResult, DecisionEngine, SpendPolicy } from "./types.js";

/** Configuration shared across an agent's runs. */
export interface PayingAgentConfig {
  /** Marketplace listings the agent may discover. */
  services: readonly AgentService[];
  /** Reputation store (read + record ratings). */
  reputation: AgentReputationStore;
  /** Transport for x402 calls (global fetch, or an in-process handler). */
  fetcher: RequestFetcher;
  /** Settler that satisfies x402 challenges (local ledger or Circle wallets). */
  settler: Settler;
  /** Payer address/identifier. */
  from: string;
  /** Spend guardrails. */
  policy: SpendPolicy;
  now?: () => Date;
  log?: (message: string) => void;
}

/**
 * Pick a decision engine: Claude when `ANTHROPIC_API_KEY` is set, otherwise the
 * deterministic heuristic engine (so the agent always runs — in CI, offline, or
 * the closed-loop harness — and upgrades to real agency when a key is present).
 */
export function defaultDecisionEngine(): DecisionEngine {
  if (typeof process !== "undefined" && process.env["ANTHROPIC_API_KEY"]) {
    return new ClaudeDecisionEngine();
  }
  return new HeuristicDecisionEngine();
}

export class PayingAgent {
  private readonly config: PayingAgentConfig;

  constructor(config: PayingAgentConfig) {
    this.config = config;
  }

  /** Run a goal to completion and return the spend report. */
  async run(goal: AgentGoal, engine: DecisionEngine = defaultDecisionEngine()): Promise<AgentRunResult> {
    const session = new AgentSession({
      objective: goal.objective,
      policy: this.config.policy,
      services: this.config.services,
      reputation: this.config.reputation,
      fetcher: this.config.fetcher,
      settler: this.config.settler,
      from: this.config.from,
      ...(goal.query !== undefined ? { defaultQuery: goal.query } : {}),
      ...(this.config.now !== undefined ? { now: this.config.now } : {}),
      ...(this.config.log !== undefined ? { log: this.config.log } : {}),
    });

    await engine.run(session);

    const totalSpent: Money = session.totalSpent;
    return {
      objective: goal.objective,
      engine: engine.name,
      purchases: [...session.purchases],
      totalSpent,
      remaining: session.remaining,
      log: [...session.log],
    };
  }
}
