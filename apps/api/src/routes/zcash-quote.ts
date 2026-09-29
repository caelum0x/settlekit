/**
 * Lock a ZEC quote for a new Zcash checkout session.
 *
 * The amount carries a per-session zatoshi tag (transparent addresses have
 * no memo), kept unique among the OPEN sessions paying the same address so
 * an incoming payment matches exactly one session. The tag is assigned and
 * the session saved atomically per payTo (Postgres advisory lock across
 * instances, in-process mutex otherwise) — see `saveWithUniqueTag`.
 */
import {
  SettleKitError,
  validationError,
  type CheckoutSession,
  type SettlementQuote,
} from "@settlekit/common";
import { withAdvisoryLock } from "@settlekit/database";
import {
  createInMemoryTagLock,
  lockQuote,
  QuoteError,
  saveWithUniqueTag,
  usdToZats,
  type TagLock,
} from "@settlekit/zcash";
import type { AppContext } from "../context.js";
import { payToFor } from "./payment-verification.js";

/** The tag embedded in a session's locked quote (amount minus the USD conversion). */
function tagOf(session: CheckoutSession): number | null {
  const quote = session.settlementQuote;
  if (quote === undefined) return null;
  const tag = BigInt(quote.amountBase) - usdToZats(session.amount.amount, quote.rate);
  return tag >= 0n ? Number(tag) : null;
}

/** Tags held by OTHER open Zcash sessions with a live quote on `payTo`. */
async function takenTags(ctx: AppContext, sessionId: string, payTo: string, now: Date): Promise<Set<number>> {
  const open = await ctx.checkouts.findOpen();
  const tags = open
    .filter((session) => session.id !== sessionId && payToFor(session, "zcash") === payTo)
    .filter((session) => session.settlementQuote !== undefined && Date.parse(session.settlementQuote.expiresAt) > now.getTime())
    .map(tagOf)
    .filter((tag): tag is number => tag !== null);
  return new Set(tags);
}

/** One in-process lock shared by every in-memory context in this process. */
const inMemoryTagLock = createInMemoryTagLock();

/** Per-payTo lock: Postgres advisory lock when a database is wired, else in-process. */
function tagLockFor(ctx: AppContext): TagLock {
  const db = ctx.db;
  if (!db) return inMemoryTagLock;
  return { withLock: (key, fn) => withAdvisoryLock(db, `zcash-tag:${key}`, fn) };
}

/**
 * Save `session` (whose `settlementQuote` was locked with tag 0 by
 * {@link lockZcashQuoteFor}) with a tag unique on `payTo`, atomically.
 */
export async function saveZcashSession(
  ctx: AppContext,
  session: CheckoutSession & { settlementQuote: SettlementQuote },
  payTo: string,
  now: Date = new Date(),
): Promise<CheckoutSession> {
  return saveWithUniqueTag({
    lock: tagLockFor(ctx),
    payTo,
    sessionId: session.id,
    baseQuote: session.settlementQuote,
    takenTags: () => takenTags(ctx, session.id, payTo, now),
    save: (settlementQuote) => ctx.checkouts.save({ ...session, settlementQuote }),
  });
}

/**
 * Lock the base (tag 0) quote for `session` paying `payTo`; the unique tag is
 * added when the session is saved via {@link saveZcashSession}. 400 when
 * Zcash is disabled, 502 when prices fail.
 */
export async function lockZcashQuoteFor(
  ctx: AppContext,
  session: CheckoutSession,
  now: Date = new Date(),
): Promise<SettlementQuote> {
  if (ctx.zcash === null) {
    throw validationError('zcash payments are not enabled on this deployment (set ZCASH_ENABLED)', { network: "zcash" });
  }
  try {
    return await lockQuote({
      usdAmount: session.amount.amount,
      tag: 0,
      sources: ctx.zcash.priceSources,
      now,
      ttlSec: ctx.zcash.quoteTtlSec,
    });
  } catch (error) {
    if (error instanceof QuoteError) {
      throw new SettleKitError({
        code: "integration_error",
        message: `could not lock a ZEC price: ${error.message}`,
        retryable: true,
      });
    }
    throw error;
  }
}
