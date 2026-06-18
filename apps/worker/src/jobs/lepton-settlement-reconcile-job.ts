/**
 * Lepton settlement reconciliation.
 *
 * Settlements submitted via Gateway/Circle confirm on-chain asynchronously. This
 * job re-checks each submitted/pending settlement receipt against the Arc
 * indexer and advances confirmed ones to `settled`, persisting the new state.
 *
 * No-op when the settlement store or a confirmation source is not configured
 * (the Lepton settlement spine is not wired on this deployment).
 */
import { reconcileReceipts } from "@settlekit/settlement-core";
import type { Job, JobContext, JobResult } from "./types.js";

export const leptonSettlementReconcileJob: Job = {
  name: "lepton-settlement-reconcile",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.settlementStore || !ctx.confirmationSource) {
      return { processed: 0, failed: 0 };
    }

    const pending = [
      ...(await ctx.settlementStore.listByStatus("submitted")),
      ...(await ctx.settlementStore.listByStatus("pending")),
    ];
    if (pending.length === 0) {
      return { processed: 0, failed: 0 };
    }

    const results = await reconcileReceipts(pending, ctx.confirmationSource, { now: ctx.now });
    let processed = 0;
    for (const result of results) {
      if (result.changed) {
        await ctx.settlementStore.put(result.receipt);
        processed += 1;
        ctx.logger.info("settlement reconciled to settled", {
          id: result.receipt.id,
          txHash: result.receipt.txHash,
        });
      }
    }
    return { processed, failed: 0 };
  },
};
