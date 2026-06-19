/**
 * The planning orchestrator: dependency graph → conserved funding plan.
 *
 * Wires the pieces together — compute structural signals, resolve each package's
 * maintainer wallet and funding context, build the allocation capability layer,
 * and let the chosen engine decide the split. The result is a {@link FundingPlan}
 * that sums to the budget exactly and is ready to settle.
 */

import { money, toBaseUnits } from "@settlekit/common";
import { type AllocationEngine, createAllocationCapabilities } from "./allocation.js";
import { HeuristicAllocationEngine } from "./heuristic-allocator.js";
import type { MaintainerResolver } from "./resolver.js";
import { computeStructuralSignals, underfundingScore } from "./signals.js";
import type { AllocationCandidate, DependencyGraph, FundingPlan } from "./types.js";

/** Input to {@link planFunding}. */
export interface PlanFundingInput {
  /** The resolved dependency graph (from {@link buildGraph}). */
  graph: DependencyGraph;
  /** Monthly budget, decimal USDC (e.g. "5"). */
  budgetUsdc: string;
  /** Resolves packages to maintainer wallets + funding context. */
  resolver: MaintainerResolver;
  /** Allocation brain. Defaults to the deterministic heuristic engine. */
  engine?: AllocationEngine;
  /** Optional real usage counts (your source imports per package). */
  usageCounts?: ReadonlyMap<string, number>;
  /** Override the funding philosophy handed to a reasoning engine. */
  philosophy?: string;
  now?: () => Date;
}

/**
 * Resolve maintainers and build the funding candidates for a graph. Exposed so
 * callers can inspect the candidate set (and its signals) before allocating.
 */
export async function buildCandidates(
  graph: DependencyGraph,
  resolver: MaintainerResolver,
  usageCounts?: ReadonlyMap<string, number>,
): Promise<AllocationCandidate[]> {
  const structural = computeStructuralSignals(graph, usageCounts ? { usageCounts } : {});
  const candidates: AllocationCandidate[] = [];
  for (const s of structural) {
    const maintainer = await resolver.resolve(s.name);
    candidates.push({
      name: s.name,
      wallet: maintainer.wallet,
      claimed: maintainer.claimed,
      ...(maintainer.handle !== undefined ? { handle: maintainer.handle } : {}),
      ...(maintainer.fundingUrl !== undefined ? { fundingUrl: maintainer.fundingUrl } : {}),
      signals: { ...s, underfunding: underfundingScore(maintainer.existingMonthlyUsd) },
    });
  }
  return candidates;
}

/** Produce a conserved {@link FundingPlan} for a project. */
export async function planFunding(input: PlanFundingInput): Promise<FundingPlan> {
  // money() validates the format and 6-dp precision; reject negatives explicitly.
  const budget = money(input.budgetUsdc);
  if (toBaseUnits(budget.amount) < 0n) {
    throw new RangeError(`budget must be non-negative, got "${input.budgetUsdc}"`);
  }

  const candidates = await buildCandidates(input.graph, input.resolver, input.usageCounts);
  const capabilities = createAllocationCapabilities({
    candidates,
    budget,
    ecosystem: input.graph.ecosystem,
    ...(input.philosophy !== undefined ? { philosophy: input.philosophy } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  const engine = input.engine ?? new HeuristicAllocationEngine();
  return engine.decide(capabilities);
}
