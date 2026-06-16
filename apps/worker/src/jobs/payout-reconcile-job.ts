/**
 * Payout reconciliation.
 *
 * A payout executed via Circle developer-controlled wallets returns a provider
 * transaction id immediately but settles on-chain asynchronously. This job
 * re-polls each executed-but-unsettled payout (status `pending` with a
 * `providerRef`) against Circle and advances it:
 *  - a transfer that now carries an on-chain `txHash` is marked **paid**;
 *  - a terminally-failed transfer is marked **failed**.
 *
 * No-op when Circle wallets are unconfigured (the executor never ran).
 */
import { markFailed, markPaid } from "@settlekit/payouts";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

/** Circle transaction states that mean the transfer will never settle. */
const FAILED_STATES = new Set(["FAILED", "CANCELLED", "DENIED"]);

export const payoutReconcileJob: Job = {
  name: "payout-reconcile",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.walletsClient) return { processed: 0, failed: 0 };

    const all = await ctx.payoutStore.listAll();
    const unsettled = all.filter((p) => p.status === "pending" && p.providerRef);

    let processed = 0;
    let failed = 0;
    for (const payout of unsettled) {
      try {
        const tx = await ctx.walletsClient.getTransaction(payout.providerRef as string);
        if (tx.txHash) {
          const result = markPaid(payout, tx.txHash, ctx.now());
          if (result.ok) {
            await ctx.payoutStore.save(result.value);
            processed += 1;
            ctx.logger.info("payout reconciled to paid", {
              payoutId: payout.id,
              txHash: tx.txHash,
            });
          }
        } else if (FAILED_STATES.has(tx.state)) {
          const result = markFailed(payout, `provider transfer ${tx.state.toLowerCase()}`, ctx.now());
          if (result.ok) {
            await ctx.payoutStore.save(result.value);
            processed += 1;
            ctx.logger.warn("payout reconciled to failed", {
              payoutId: payout.id,
              state: tx.state,
            });
          }
        }
        // Otherwise still in flight; leave pending for a later tick.
      } catch (error) {
        failed += 1;
        ctx.logger.error("payout reconcile failed", {
          payoutId: payout.id,
          error: errorMessage(error),
        });
      }
    }

    return { processed, failed };
  },
};
