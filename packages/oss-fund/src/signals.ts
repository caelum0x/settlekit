/**
 * Signal computation — translating graph structure into allocation inputs.
 *
 * Three of the four signals are structural and computed here; the fourth
 * (underfunding) needs maintainer funding data and is attached during planning.
 *
 *   directness   how directly you depend on a package (1 = direct, decays w/ depth)
 *   reach        how load-bearing it is (transitive dependents within your tree)
 *   usage        how much you actually use it (import scan, or in-degree proxy)
 *   runtimeFactor prod code outweighs dev tooling
 */

import type { DependencyGraph, DependencyKind, StructuralSignals } from "./types.js";
import { computeInDegree, computeReach } from "./graph.js";

/** Options for {@link computeStructuralSignals}. */
export interface SignalOptions {
  /**
   * Real usage counts — e.g. how many of your source files import each package,
   * obtained by scanning imports. When omitted, in-degree is used as a proxy.
   */
  usageCounts?: ReadonlyMap<string, number>;
}

/** How much a dependency kind counts toward funding (shipped code weighs most). */
export function runtimeFactor(kind: DependencyKind): number {
  switch (kind) {
    case "prod":
      return 1;
    case "peer":
      return 0.7;
    case "optional":
      return 0.6;
    case "dev":
      return 0.4;
  }
}

/** Compute the structural (graph-derived) signals for every node. */
export function computeStructuralSignals(
  graph: DependencyGraph,
  options: SignalOptions = {},
): StructuralSignals[] {
  const reach = computeReach(graph);
  const inDegree = computeInDegree(graph);
  const usageCounts = options.usageCounts;

  return graph.nodes.map((node) => {
    const directUsage = usageCounts?.get(node.name);
    // Fall back to in-degree (with a floor of 1 for direct deps you clearly use).
    const usage =
      directUsage !== undefined
        ? directUsage
        : Math.max(inDegree.get(node.name) ?? 0, node.direct ? 1 : 0);
    return {
      name: node.name,
      directness: 1 / (1 + node.depth),
      reach: reach.get(node.name) ?? 0,
      usage,
      runtimeFactor: runtimeFactor(node.kind),
    };
  });
}

/** 0–1 underfunding score from known existing monthly funding (USD). */
export function underfundingScore(existingMonthlyUsd: string): number {
  const usd = Number(existingMonthlyUsd);
  if (!Number.isFinite(usd) || usd <= 0) return 1;
  // Half-funded at $50/mo, asymptotically approaching 0 as funding grows.
  return 50 / (50 + usd);
}
