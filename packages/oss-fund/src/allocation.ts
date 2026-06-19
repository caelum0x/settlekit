/**
 * The allocation capability surface and engine contract.
 *
 * This is the heart of the tool — and deliberately structured like the paying
 * agent's capability layer: an {@link AllocationEngine} (heuristic or Claude)
 * only ever *proposes relative weights*. The capability layer is the policy
 * enforcer: it converts weights into a conserved integer allocation (so the
 * legs always sum to the budget exactly), groups packages by maintainer wallet,
 * and routes unregistered maintainers to escrow. No engine — however it reasons —
 * can create money, lose money, pay an unknown wallet, or go over budget, because
 * the enforcement lives in code, not in the model's output.
 */

import {
  type IsoTimestamp,
  type Money,
  fromBaseUnits,
  money,
  toBaseUnits,
  toIso,
} from "@settlekit/common";
import { conservedAllocation } from "./conservation.js";
import type {
  AllocationCandidate,
  Ecosystem,
  FundingPlan,
  PackageAllocation,
  WalletLeg,
} from "./types.js";

/** A relative weight an engine assigns to one package. */
export interface AllocationWeight {
  name: string;
  /** Any non-negative magnitude; only the ratios between weights matter. */
  weight: number;
}

/**
 * The surface an {@link AllocationEngine} drives. `candidates()` exposes the
 * packages and their signals; `allocate()` is the only way to turn a judgement
 * into a plan, and it enforces every invariant.
 */
export interface AllocationCapabilities {
  readonly budget: Money;
  /** A natural-language funding philosophy handed to a reasoning engine. */
  readonly philosophy: string;
  candidates(): readonly AllocationCandidate[];
  /** Build a conserved {@link FundingPlan} from a set of weights. */
  allocate(weights: readonly AllocationWeight[], engineName?: string): FundingPlan;
}

/** A pluggable allocation brain: deterministic heuristic, or Claude. */
export interface AllocationEngine {
  readonly name: string;
  decide(capabilities: AllocationCapabilities): Promise<FundingPlan>;
}

/** Options for {@link createAllocationCapabilities}. */
export interface CapabilityOptions {
  candidates: readonly AllocationCandidate[];
  budget: Money;
  ecosystem: Ecosystem;
  philosophy?: string;
  now?: () => Date;
}

const DEFAULT_PHILOSOPHY =
  "Fund the maintainers your project most depends on. Weigh how directly and " +
  "heavily you use a package, how load-bearing it is across your dependency tree, " +
  "and how underfunded its maintainer is. Reward critical, underfunded, " +
  "production dependencies over incidental or already well-funded ones. This is " +
  "not an equal split — it is an informed allocation of a scarce budget.";

export function createAllocationCapabilities(options: CapabilityOptions): AllocationCapabilities {
  const candidates = [...options.candidates];
  const now = options.now ?? (() => new Date());
  const budgetBase = toBaseUnits(options.budget.amount);

  return {
    budget: options.budget,
    philosophy: options.philosophy ?? DEFAULT_PHILOSOPHY,
    candidates: () => candidates,
    allocate(weights: readonly AllocationWeight[], engineName = "custom"): FundingPlan {
      const byName = new Map<string, number>();
      for (const w of weights) {
        const value = Number.isFinite(w.weight) && w.weight > 0 ? w.weight : 0;
        // Last positive weight for a name wins; a later 0 does not erase a prior value.
        if (value > 0 || !byName.has(w.name)) byName.set(w.name, value);
      }

      const weightVector = candidates.map((c) => byName.get(c.name) ?? 0);
      const amounts = conservedAllocation(weightVector, budgetBase);

      const allocations: PackageAllocation[] = candidates.map((candidate, i) => {
        const base = amounts[i] as bigint;
        return {
          name: candidate.name,
          wallet: candidate.wallet,
          ...(candidate.handle !== undefined ? { handle: candidate.handle } : {}),
          claimed: candidate.claimed,
          amount: money(fromBaseUnits(base)),
          weight: budgetBase > 0n ? Number(base) / Number(budgetBase) : 0,
          signals: candidate.signals,
        };
      });

      const { legs, unclaimed } = groupIntoLegs(allocations);

      const createdAt: IsoTimestamp = toIso(now());
      return {
        ecosystem: options.ecosystem,
        budget: options.budget,
        engine: engineName,
        allocations,
        legs,
        unclaimed,
        createdAt,
      };
    },
  };
}

/** Collapse per-package allocations into one leg per wallet. */
function groupIntoLegs(allocations: readonly PackageAllocation[]): {
  legs: WalletLeg[];
  unclaimed: Money;
} {
  const byWallet = new Map<string, { base: bigint; claimed: boolean; packages: string[] }>();
  for (const alloc of allocations) {
    const base = toBaseUnits(alloc.amount.amount);
    const entry = byWallet.get(alloc.wallet);
    if (entry === undefined) {
      byWallet.set(alloc.wallet, { base, claimed: alloc.claimed, packages: [alloc.name] });
    } else {
      entry.base += base;
      entry.packages.push(alloc.name);
    }
  }

  let unclaimedBase = 0n;
  const legs: WalletLeg[] = [];
  for (const [wallet, entry] of byWallet) {
    if (entry.base === 0n) continue;
    if (!entry.claimed) unclaimedBase += entry.base;
    legs.push({
      wallet,
      amount: money(fromBaseUnits(entry.base)),
      claimed: entry.claimed,
      packages: entry.packages.sort(),
    });
  }
  legs.sort((a, b) => {
    const cmp = toBaseUnits(b.amount.amount) - toBaseUnits(a.amount.amount);
    return cmp > 0n ? 1 : cmp < 0n ? -1 : a.wallet.localeCompare(b.wallet);
  });

  return { legs, unclaimed: money(fromBaseUnits(unclaimedBase)) };
}
