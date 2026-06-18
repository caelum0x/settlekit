/**
 * Recursive royalty splitting.
 *
 * Accessing a source pays a toll. After the platform fee is taken off the top,
 * the remainder is distributed across the citation lineage: each work keeps its
 * author share and passes the cited shares down to its ancestors, recursively.
 * A remix of a remix pays every ancestor; a diamond in the graph pays a shared
 * ancestor from each path. Money is conserved exactly — integer-division
 * remainders stay with the author of the node they arose in.
 */

import {
  type Money,
  fromBaseUnits,
  money,
  subtractMoney,
  toBaseUnits,
} from "@settlekit/common";
import {
  type PlatformFeeSchedule,
  applicationFee,
} from "@settlekit/platform-billing";
import type { SourceRegistry } from "./registry.js";
import type { RoyaltyDistribution, RoyaltyLeg } from "./types.js";

const MAX_BPS = 10_000n;

/**
 * Nanopayment-friendly default: 2.5% with NO fixed component. A fixed per-call
 * fee (like the standard $0.30) would swallow a sub-cent toll, so citation tolls
 * use a purely proportional fee. See platform take-rate model.
 */
export const NANO_FEE_SCHEDULE: PlatformFeeSchedule = { bps: 250, fixed: "0" };

interface Accumulated {
  wallet: string;
  base: bigint;
  depth: number;
}

function distributeBase(
  registry: SourceRegistry,
  rootId: string,
  baseAmount: bigint,
): Map<string, Accumulated> {
  const acc = new Map<string, Accumulated>();

  const add = (sourceId: string, wallet: string, base: bigint, depth: number): void => {
    const existing = acc.get(sourceId);
    if (existing === undefined) {
      acc.set(sourceId, { wallet, base, depth });
    } else {
      existing.base += base;
      existing.depth = Math.min(existing.depth, depth);
    }
  };

  const recurse = (id: string, amount: bigint, depth: number, path: ReadonlySet<string>): void => {
    const source = registry.get(id);
    if (source === undefined) {
      return;
    }
    const validCites = source.cites.filter(
      (c) => c.sourceId !== id && !path.has(c.sourceId) && registry.get(c.sourceId) !== undefined,
    );

    let childTotal = 0n;
    const childAmounts = validCites.map((c) => {
      const share = (amount * BigInt(c.shareBps)) / MAX_BPS;
      childTotal += share;
      return { sourceId: c.sourceId, share };
    });

    const authorKeep = amount - childTotal;
    add(id, source.authorWallet, authorKeep, depth);

    const nextPath = new Set(path);
    nextPath.add(id);
    for (const child of childAmounts) {
      recurse(child.sourceId, child.share, depth + 1, nextPath);
    }
  };

  recurse(rootId, baseAmount, 0, new Set());
  return acc;
}

/**
 * Compute the full royalty distribution for one access to `sourceId`.
 *
 * @param registry  Source graph.
 * @param sourceId  The accessed source.
 * @param schedule  Platform fee schedule (defaults to {@link NANO_FEE_SCHEDULE}).
 */
export function computeRoyaltyDistribution(
  registry: SourceRegistry,
  sourceId: string,
  schedule: PlatformFeeSchedule = NANO_FEE_SCHEDULE,
): RoyaltyDistribution | undefined {
  const source = registry.get(sourceId);
  if (source === undefined) {
    return undefined;
  }

  const gross = money(source.priceUsdc);
  const platformFee = applicationFee(gross, schedule);
  const distributable = subtractMoney(gross, platformFee);

  const acc = distributeBase(registry, sourceId, toBaseUnits(distributable.amount));

  const legs: RoyaltyLeg[] = [...acc.entries()]
    .map(([id, a]) => ({
      sourceId: id,
      wallet: a.wallet,
      amount: money(fromBaseUnits(a.base)),
      depth: a.depth,
    }))
    .filter((leg) => leg.amount.amount !== "0")
    .sort((a, b) => a.depth - b.depth || a.sourceId.localeCompare(b.sourceId));

  return {
    sourceId,
    gross,
    platformFee,
    distributable,
    legs,
  };
}

/** Sum of all legs — useful for asserting conservation in tests/metrics. */
export function distributedTotal(distribution: RoyaltyDistribution): Money {
  return distribution.legs.reduce<Money>(
    (sum, leg) => money(fromBaseUnits(toBaseUnits(sum.amount) + toBaseUnits(leg.amount.amount))),
    money("0"),
  );
}
