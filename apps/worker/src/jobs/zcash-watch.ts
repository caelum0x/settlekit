/**
 * Zcash payment watcher (every 90 s by default).
 *
 * Transparent addresses carry no memo, so each open Zcash session owes a
 * unique zatoshi amount (quote + tag). This job makes ONE explorer call per
 * payTo address that has open, watchable Zcash sessions (none → no network
 * call at all), matches incoming amounts to sessions and attaches the txid
 * to the session's pending payment. The payment-confirm job then verifies
 * it fully (confirmations, block time, late → manual review) before anything
 * is granted. Sessions are watched until an hour after their quote expired
 * to keep the explorer's keyless quota; later payments go through pasted
 * txids and manual review.
 */

import { recordPendingPayment } from "@settlekit/payments";
import type { CheckoutSession, Payment } from "@settlekit/common";
import { matchZcashPayment, type ZcashAddressActivity } from "@settlekit/zcash";
import { errorMessage } from "../logger.js";
import { sessionPayTo } from "./payment-verification.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const WATCH_AFTER_QUOTE_EXPIRY_MS = 60 * 60 * 1000;
export const ZCASH_ACTIVITY_LIMIT = 50;

function isWatchable(session: CheckoutSession, now: Date): boolean {
  const accepted = session.acceptedNetworks ?? [session.network];
  const quote = session.settlementQuote;
  if (!accepted.includes("zcash") || quote === undefined) return false;
  return now.getTime() <= new Date(quote.expiresAt).getTime() + WATCH_AFTER_QUOTE_EXPIRY_MS;
}

function groupByPayTo(sessions: readonly CheckoutSession[]): Map<string, CheckoutSession[]> {
  const groups = new Map<string, CheckoutSession[]>();
  for (const session of sessions) {
    const payTo = sessionPayTo(session, "zcash");
    groups.set(payTo, [...(groups.get(payTo) ?? []), session]);
  }
  return groups;
}

/** Attach `txid` to the session's pending payment (or record one). Returns true when stored. */
async function attach(ctx: JobContext, session: CheckoutSession, txid: string, pending: readonly Payment[]): Promise<boolean> {
  const owner = await ctx.stores.paymentByTxHash(txid);
  if (owner) {
    if (owner.checkoutSessionId !== session.id) {
      ctx.logger.warn("zcash txid already backs another payment", { txid, sessionId: session.id, paymentId: owner.id });
    }
    return false;
  }
  const existing = pending.find((payment) => payment.checkoutSessionId === session.id && payment.txHash === undefined);
  if (existing) {
    await ctx.stores.upsertPayment({ ...existing, network: "zcash", txHash: txid });
    return true;
  }
  if (session.customerId === undefined) {
    ctx.logger.warn("zcash payment seen for a session without a customer; cannot record it", { sessionId: session.id, txid });
    return false;
  }
  await ctx.stores.upsertPayment(
    recordPendingPayment(
      {
        organizationId: session.organizationId,
        checkoutSessionId: session.id,
        customerId: session.customerId,
        amount: session.amount,
        network: "zcash",
        txHash: txid,
      },
      ctx.now(),
    ),
  );
  return true;
}

async function scanAddress(
  ctx: JobContext,
  sessions: readonly CheckoutSession[],
  activity: readonly ZcashAddressActivity[],
  pending: readonly Payment[],
): Promise<number> {
  let attached = 0;
  for (const session of sessions) {
    const quote = session.settlementQuote;
    if (quote === undefined) continue;
    const match = matchZcashPayment(activity, { expectedZats: BigInt(quote.amountBase), notBefore: new Date(session.createdAt) });
    if (match === null) continue;
    if (await attach(ctx, session, match.txid, pending)) {
      attached += 1;
      ctx.logger.info("zcash payment matched to session", { sessionId: session.id, txid: match.txid });
    }
  }
  return attached;
}

export const zcashWatchJob: Job = {
  name: "zcash-watch",
  async run(ctx: JobContext): Promise<JobResult> {
    if (!ctx.zcash) return { processed: 0, failed: 0 };
    const now = ctx.now();
    const watchable = (await ctx.stores.openCheckoutSessions()).filter((session) => isWatchable(session, now));
    if (watchable.length === 0) return { processed: 0, failed: 0 };

    const pending = await ctx.stores.pendingPayments();
    let processed = 0;
    let failed = 0;
    for (const [payTo, sessions] of groupByPayTo(watchable)) {
      try {
        const activity = await ctx.zcash.explorer.getAddressActivity(payTo, ZCASH_ACTIVITY_LIMIT);
        if (!activity.ok) {
          failed += 1;
          ctx.logger.warn("zcash explorer unavailable; will retry", { payTo, status: activity.status, reason: activity.reason });
          continue;
        }
        processed += await scanAddress(ctx, sessions, activity.value, pending);
      } catch (error) {
        failed += 1;
        ctx.logger.error("zcash watch failed", { payTo, error: errorMessage(error) });
      }
    }
    return { processed, failed };
  },
};
