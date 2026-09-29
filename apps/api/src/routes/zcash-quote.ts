/**
 * Lock a ZEC quote for a new Zcash checkout session.
 *
 * The amount carries a per-session zatoshi tag (transparent addresses have
 * no memo), kept unique among the OPEN sessions paying the same address so
 * an incoming payment matches exactly one session.
 */
import {
  SettleKitError,
  validationError,
  type CheckoutSession,
  type SettlementQuote,
} from "@settlekit/common";
import { assignTag, lockQuote, QuoteError, usdToZats } from "@settlekit/zcash";
import type { AppContext } from "../context.js";
import { payToFor } from "./payment-verification.js";

/** The tag embedded in a session's locked quote (amount minus the USD conversion). */
function tagOf(session: CheckoutSession): number | null {
  const quote = session.settlementQuote;
  if (quote === undefined) return null;
  const tag = BigInt(quote.amountBase) - usdToZats(session.amount.amount, quote.rate);
  return tag >= 0n ? Number(tag) : null;
}

/** Tags held by other open Zcash sessions on `payTo`. */
async function takenTags(ctx: AppContext, payTo: string): Promise<Set<number>> {
  const open = await ctx.checkouts.findOpen();
  const tags = open
    .filter((session) => payToFor(session, "zcash") === payTo)
    .map(tagOf)
    .filter((tag): tag is number => tag !== null);
  return new Set(tags);
}

/** Lock a quote for `session` paying `payTo`; 400 when Zcash is disabled, 502 when prices fail. */
export async function lockZcashQuoteFor(
  ctx: AppContext,
  session: CheckoutSession,
  payTo: string,
  now: Date = new Date(),
): Promise<SettlementQuote> {
  if (ctx.zcash === null) {
    throw validationError('zcash payments are not enabled on this deployment (set ZCASH_ENABLED)', { network: "zcash" });
  }
  const tag = assignTag(session.id, await takenTags(ctx, payTo));
  try {
    return await lockQuote({
      usdAmount: session.amount.amount,
      tag,
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
