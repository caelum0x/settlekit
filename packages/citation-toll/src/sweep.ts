/**
 * Sweep pending royalty legs into author payouts.
 *
 * Groups all pending legs by recipient wallet and settles each group in one
 * transfer via a {@link SettlementProvider} — turning thousands of sub-cent
 * leptons into one payout per author — then marks the swept legs settled with
 * the receipt id. Shared by the settlement worker and the citation-toll
 * sidecars so the money path has a single implementation.
 */

import { type PaymentNetwork, fromBaseUnits, money, toBaseUnits } from "@settlekit/common";
import type { SettlementProvider } from "@settlekit/settlement-core";
import type { PersistedRoyaltyLeg, RoyaltyLegStore } from "./store.js";

export interface SweepResult {
  /** Legs marked settled. */
  processed: number;
  /** Legs that failed to settle this pass. */
  failed: number;
  /** Settlement receipt ids produced. */
  receipts: string[];
}

export interface SweepOptions {
  /** Called when a recipient group fails to settle. */
  onError?: (wallet: string, error: unknown) => void;
}

interface Group {
  wallet: string;
  network: PaymentNetwork;
  totalBase: bigint;
  legs: PersistedRoyaltyLeg[];
}

export async function sweepPendingRoyalties(
  store: RoyaltyLegStore,
  provider: SettlementProvider,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const pending = await store.listPending();
  if (pending.length === 0) {
    return { processed: 0, failed: 0, receipts: [] };
  }

  const groups = new Map<string, Group>();
  for (const leg of pending) {
    const key = `${leg.network}|${leg.wallet.toLowerCase()}`;
    const group = groups.get(key);
    const amountBase = toBaseUnits(leg.amount.amount);
    if (group === undefined) {
      groups.set(key, { wallet: leg.wallet, network: leg.network, totalBase: amountBase, legs: [leg] });
    } else {
      group.totalBase += amountBase;
      group.legs.push(leg);
    }
  }

  let processed = 0;
  let failed = 0;
  const receipts: string[] = [];
  for (const group of groups.values()) {
    const legIds = group.legs.map((l) => l.id).sort();
    const reference = `royalty-sweep:${group.network}:${group.wallet.toLowerCase()}:${legIds.join(",")}`;
    try {
      const receipt = await provider.settle({
        reference,
        to: group.wallet,
        amountUsdc: money(fromBaseUnits(group.totalBase)).amount,
        network: group.network,
      });
      for (const leg of group.legs) {
        await store.markSettled(leg.id, receipt.id);
        processed += 1;
      }
      receipts.push(receipt.id);
    } catch (error) {
      failed += group.legs.length;
      options.onError?.(group.wallet, error);
    }
  }
  return { processed, failed, receipts };
}
