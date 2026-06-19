/**
 * Open-source funding domain types.
 *
 * The thesis: every developer depends on hundreds of packages whose maintainers
 * are usually paid nothing. "Donate" buttons fail because nobody sends 50 cents
 * to thirty maintainers by hand — the card fee dwarfs the gift. SettleKit's
 * nanopayment spine settles sub-cent USDC for free, so a single small monthly
 * budget can fan out across an entire dependency tree.
 *
 * This module turns a manifest (`package.json` / `requirements.txt`) into a
 * resolved dependency graph, scores each package by how much you actually rely
 * on it, maps maintainers to wallets, and lets an allocation engine split the
 * budget — settling the result over the existing recursive-split distributor.
 */

import type { IsoTimestamp, Money } from "@settlekit/common";

/** The package ecosystem a dependency belongs to. */
export type Ecosystem = "npm" | "pypi";

/** How a *direct* dependency was declared in the manifest. */
export type DependencyKind = "prod" | "dev" | "peer" | "optional";

/** The synthetic node representing your own project at the root of the graph. */
export const ROOT = "@@root@@";

/** A resolved package in the dependency graph. */
export interface DependencyNode {
  /** Canonical package name within its ecosystem (e.g. "react", "requests"). */
  name: string;
  /** Resolved or declared version, when known. */
  version?: string;
  /** True when declared directly in your manifest (not pulled in transitively). */
  direct: boolean;
  /**
   * Effective dependency kind. Direct nodes use their declared kind; transitive
   * nodes are "prod" if reachable through any production path, else "dev".
   */
  kind: DependencyKind;
  /** Shortest distance from one of your direct deps (0 = a direct dep). */
  depth: number;
}

/** A directed edge "`from` depends on `to`". `from` may be {@link ROOT}. */
export interface DependencyEdge {
  from: string;
  to: string;
}

/** The resolved dependency graph for one project. */
export interface DependencyGraph {
  ecosystem: Ecosystem;
  /** The root project name, if the manifest declared one. */
  root?: string;
  nodes: readonly DependencyNode[];
  edges: readonly DependencyEdge[];
}

/**
 * The four signals the allocator weighs. Each is the answer to a real question
 * about how much a maintainer's work matters to *your* project — not an equal
 * split, but an informed judgement.
 */
export interface DependencySignals {
  name: string;
  /** 0–1 — how directly you depend on it (1 = direct, decays with depth). */
  directness: number;
  /**
   * How load-bearing it is: the count of distinct packages in your graph that
   * (transitively) depend on it. A package the whole tree leans on is critical —
   * if it breaks or its maintainer quits, much of your stack is at risk.
   */
  reach: number;
  /**
   * How much you actually use it: the number of your own source modules that
   * import it (when a usage scan is supplied), otherwise its in-degree in the
   * graph as a structural proxy.
   */
  usage: number;
  /** 0–1 — how underfunded the maintainer is (1 = receives nothing known). */
  underfunding: number;
  /** Multiplier from the dependency kind (shipped prod code outweighs dev tooling). */
  runtimeFactor: number;
}

/** The structural signals computed purely from the graph (no funding data yet). */
export type StructuralSignals = Omit<DependencySignals, "underfunding">;

/** A maintainer resolved to a payout wallet. */
export interface ResolvedMaintainer {
  /** GitHub login / org handle used as the payee external id, when known. */
  handle?: string;
  /** The wallet that receives this maintainer's share. */
  wallet: string;
  /** True if the wallet is a registered maintainer; false for the escrow fallback. */
  claimed: boolean;
  /** Known existing monthly funding, decimal USD ("0" if unknown/none). */
  existingMonthlyUsd: string;
  /** Where to fund / claim (GitHub Sponsors, Open Collective, custom URL), if discovered. */
  fundingUrl?: string;
}

/** A funding candidate: a package, its wallet, and the signals behind its share. */
export interface AllocationCandidate {
  name: string;
  wallet: string;
  claimed: boolean;
  handle?: string;
  fundingUrl?: string;
  signals: DependencySignals;
}

/** One package's slice of the budget. */
export interface PackageAllocation {
  name: string;
  wallet: string;
  handle?: string;
  fundingUrl?: string;
  claimed: boolean;
  /** The conserved amount allocated to this package. */
  amount: Money;
  /** Share of the total allocation weight, 0–1. */
  weight: number;
  signals: DependencySignals;
}

/**
 * A settlement leg: all packages routed to one wallet collapse into a single
 * payout — the shape {@link https RecursiveSplitDistributor.distribute} consumes.
 */
export interface WalletLeg {
  wallet: string;
  amount: Money;
  claimed: boolean;
  /** Packages funded through this wallet. */
  packages: readonly string[];
}

/** A complete, conserved funding plan ready to settle. */
export interface FundingPlan {
  ecosystem: Ecosystem;
  /** The monthly budget being distributed. */
  budget: Money;
  /** Name of the allocation engine that produced it ("heuristic" | "claude"). */
  engine: string;
  /** Per-package allocations — sums exactly to {@link budget}. */
  allocations: readonly PackageAllocation[];
  /** Per-wallet legs (allocations grouped by wallet) — sums exactly to {@link budget}. */
  legs: readonly WalletLeg[];
  /**
   * Amount earmarked to the unclaimed-earnings escrow (maintainers not yet
   * registered with a wallet). Still conserved and claimable once they register.
   */
  unclaimed: Money;
  createdAt: IsoTimestamp;
}

/** One settled leg. */
export interface LegSettlement {
  wallet: string;
  amount: Money;
  txHash: string;
  packages: readonly string[];
}

/** The reconciled outcome of settling a {@link FundingPlan}. */
export interface FundingReceipt {
  plan: FundingPlan;
  settlements: readonly LegSettlement[];
  /** Total actually moved through the settler. */
  distributed: Money;
  /** True when `distributed === budget` and every leg settled. */
  reconciled: boolean;
}
