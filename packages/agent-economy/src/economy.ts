/**
 * The closed-loop agent economy: N autonomous paying agents discover and pay
 * citation tolls; the publisher settles recursive royalties to authors. Returns
 * a reconciled report (volume, platform fees, per-author earnings, per-agent
 * spend) — the traction story, self-driven.
 */

import {
  type Money,
  fromBaseUnits,
  money,
  toBaseUnits,
} from "@settlekit/common";
import { InMemoryAgentReputationStore } from "@settlekit/agent-services";
import {
  PayingAgent,
  type DecisionEngine,
  HeuristicDecisionEngine,
} from "@settlekit/agent";
import {
  InMemorySourceRegistry,
  type Source,
  createCitationTollRouter,
  toAgentServiceListing,
} from "@settlekit/citation-toll";
import { createLocalSettlement } from "@settlekit/x402-client";

/** Options for {@link runAgentEconomy}. */
export interface AgentEconomyOptions {
  /** The marketplace of citeable sources. */
  sources: readonly Source[];
  /** Number of autonomous agents to run. */
  agentCount: number;
  /** Per-agent total budget, decimal USDC. */
  perAgentBudgetUsdc: string;
  /** Per-call cap, decimal USDC. */
  maxPriceUsdc?: string;
  /** Max paid calls per agent. */
  maxPurchasesPerAgent?: number;
  /** Base URL for the toll endpoints. */
  baseUrl?: string;
  /** Objective handed to each agent. */
  objective?: string;
  /** Build the decision engine. Defaults to the deterministic heuristic engine
   * (so the economy runs in CI / offline). Pass a Claude engine for real agency. */
  makeEngine?: () => DecisionEngine;
  log?: (message: string) => void;
}

/** A single author's accumulated royalty earnings. */
export interface AuthorEarning {
  wallet: string;
  amountUsdc: string;
}

/** One agent's spend summary. */
export interface AgentSpend {
  from: string;
  spentUsdc: string;
  purchases: number;
}

/** Reconciled economy report. */
export interface EconomyReport {
  agents: number;
  totalPayments: number;
  totalVolumeUsdc: string;
  platformFeesUsdc: string;
  authorEarnings: AuthorEarning[];
  perAgent: AgentSpend[];
}

const DEFAULT_OBJECTIVE =
  "Build up grounded knowledge about Lepton-era nanopayments by buying the most useful cited sources your budget allows.";

/** Run the closed-loop economy and return a reconciled report. */
export async function runAgentEconomy(options: AgentEconomyOptions): Promise<EconomyReport> {
  const baseUrl = options.baseUrl ?? "https://lepton.local";

  const registry = new InMemorySourceRegistry();
  for (const source of options.sources) {
    registry.add(source);
  }

  const settlement = createLocalSettlement();

  // Accumulate royalty splits per author and platform fees as payments settle.
  const authorBase = new Map<string, bigint>();
  let platformFeeBase = 0n;
  const router = createCitationTollRouter(registry, {
    verify: settlement.verify,
    distributor: (distribution) => {
      platformFeeBase += toBaseUnits(distribution.platformFee.amount);
      for (const leg of distribution.legs) {
        authorBase.set(
          leg.wallet,
          (authorBase.get(leg.wallet) ?? 0n) + toBaseUnits(leg.amount.amount),
        );
      }
    },
  });

  const listings = registry.all().map((source) => toAgentServiceListing(source, { baseUrl }));

  // A shared reputation store: ratings from early agents inform later ones —
  // emergent reputation, the way a real marketplace would behave.
  const reputation = new InMemoryAgentReputationStore();
  const makeEngine = options.makeEngine ?? (() => new HeuristicDecisionEngine());

  const perAgent: AgentSpend[] = [];

  for (let i = 0; i < options.agentCount; i += 1) {
    const from = `0xagent${String(i + 1).padStart(2, "0")}`;
    const agent = new PayingAgent({
      services: listings,
      reputation,
      fetcher: router,
      settler: settlement.settler,
      from,
      policy: {
        totalBudgetUsdc: options.perAgentBudgetUsdc,
        ...(options.maxPriceUsdc !== undefined ? { maxPriceUsdc: options.maxPriceUsdc } : {}),
        ...(options.maxPurchasesPerAgent !== undefined
          ? { maxPurchases: options.maxPurchasesPerAgent }
          : {}),
      },
      ...(options.log !== undefined ? { log: options.log } : {}),
    });

    const result = await agent.run(
      { objective: options.objective ?? DEFAULT_OBJECTIVE },
      makeEngine(),
    );
    perAgent.push({
      from,
      spentUsdc: result.totalSpent.amount,
      purchases: result.purchases.length,
    });
  }

  const totalVolume: Money = settlement.ledger.totalVolume();

  const authorEarnings: AuthorEarning[] = [...authorBase.entries()]
    .map(([wallet, base]) => ({ wallet, amountUsdc: fromBaseUnits(base) }))
    .filter((e) => e.amountUsdc !== "0")
    .sort((a, b) => Number(b.amountUsdc) - Number(a.amountUsdc));

  return {
    agents: options.agentCount,
    totalPayments: settlement.ledger.count(),
    totalVolumeUsdc: totalVolume.amount,
    platformFeesUsdc: money(fromBaseUnits(platformFeeBase)).amount,
    authorEarnings,
    perAgent,
  };
}
