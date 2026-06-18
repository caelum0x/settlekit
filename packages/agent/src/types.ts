/**
 * Public types for the autonomous paying agent.
 *
 * The agent discovers x402-priced services, decides which to pay for under a
 * spend policy, settles the toll, consumes the result, and rates the service —
 * a self-directed economic actor, not a script.
 */

import type { IsoTimestamp, Money } from "@settlekit/common";
import type { AgentDiscoveryQuery } from "@settlekit/agent-services";

/** Hard guardrails the agent (and every decision engine) must respect. */
export interface SpendPolicy {
  /** Total spend cap for one run, decimal USDC. */
  totalBudgetUsdc: string;
  /** Per-call price cap, decimal USDC. Calls above this are refused. */
  maxPriceUsdc?: string;
  /** Skip services whose average rating (out of 5) is below this, once rated. */
  minReputation?: number;
  /** Maximum number of paid calls in one run. */
  maxPurchases?: number;
}

/** What the agent is trying to accomplish. */
export interface AgentGoal {
  /** Natural-language objective handed to the decision engine. */
  objective: string;
  /** Optional discovery filter for the marketplace. */
  query?: AgentDiscoveryQuery;
}

/** A marketplace service the agent can consider, with live reputation. */
export interface DiscoveredService {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  priceUsdc: string;
  network: "arc" | "base";
  ratingAverage: number;
  ratingCount: number;
}

/** A completed paid call. */
export interface PurchaseRecord {
  serviceId: string;
  endpoint: string;
  amount: Money;
  txHash: string;
  rating?: number;
  contentPreview?: string;
  at: IsoTimestamp;
}

/** Result of attempting a paid call (guardrails enforced before payment). */
export interface BuyResult {
  ok: boolean;
  reason?: string;
  content?: unknown;
  record?: PurchaseRecord;
}

/** Live run status. */
export interface AgentStatus {
  spentUsdc: string;
  remainingUsdc: string;
  purchases: number;
  maxPurchases?: number;
}

/**
 * The capability surface a decision engine drives. Every spend guardrail is
 * enforced inside {@link AgentCapabilities.buy}, so no engine — heuristic or
 * Claude — can exceed the policy regardless of what it decides.
 */
export interface AgentCapabilities {
  readonly objective: string;
  readonly policy: SpendPolicy;
  discover(query?: AgentDiscoveryQuery): Promise<DiscoveredService[]>;
  evaluate(serviceId: string): Promise<DiscoveredService | null>;
  buy(serviceId: string): Promise<BuyResult>;
  rate(serviceId: string, stars: number): Promise<void>;
  status(): AgentStatus;
}

/** A pluggable brain: heuristic (deterministic) or Claude (tool-use loop). */
export interface DecisionEngine {
  readonly name: string;
  run(capabilities: AgentCapabilities): Promise<void>;
}

/** Final outcome of a run. */
export interface AgentRunResult {
  objective: string;
  engine: string;
  purchases: PurchaseRecord[];
  totalSpent: Money;
  remaining: Money;
  log: string[];
}
