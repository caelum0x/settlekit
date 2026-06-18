/**
 * Wire the citation-toll royalty distribution to the production settlement
 * spine. On each paid citation, record one pending royalty leg per recipient in
 * the lineage; the settlement worker (or the /admin/sweep endpoint) batches and
 * settles them via `@settlekit/settlement-core`. This is the "flip onto
 * settlement-core": demo settlement is gone — payouts are real, batched, and
 * reconciled.
 */

import { toIso, uuid } from "@settlekit/common";
import type { RoyaltyDistributor, RoyaltyLegStore } from "@settlekit/citation-toll";
import { newAccessId } from "./ingestor.js";

export interface TollDistributorDeps {
  royaltyLegStore: RoyaltyLegStore;
  now?: () => Date;
}

/** Build a {@link RoyaltyDistributor} that records pending royalty legs. */
export function createTollDistributor(deps: TollDistributorDeps): RoyaltyDistributor {
  const now = deps.now ?? (() => new Date());
  return async (distribution, source) => {
    const accessId = newAccessId();
    for (const leg of distribution.legs) {
      await deps.royaltyLegStore.append({
        id: `leg_${uuid().replace(/-/g, "").slice(0, 24)}`,
        sourceId: leg.sourceId,
        accessId,
        wallet: leg.wallet,
        network: source.network,
        amount: leg.amount,
        depth: leg.depth,
        status: "pending",
        createdAt: toIso(now()),
      });
    }
  };
}
