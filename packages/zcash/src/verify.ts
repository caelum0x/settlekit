/**
 * Verify a transparent Zcash payment against a locked session quote.
 *
 * Rules: the txid is well formed and known; it pays `payTo` the expected
 * zatoshis (exactly, by default: the amount tag binds the payment to one
 * session); it is mined with enough confirmations; it was mined no earlier
 * than `notBefore` minus {@link NOT_BEFORE_SKEW_MS} (block timestamps are
 * second-resolution miner clocks that may trail wall time); and when mined more
 * than 10 minutes after the quote expired it is `late` — the buyer paid, but
 * at a stale price, so a human reviews instead of auto-confirming.
 */

import type { ZcashExplorer } from "./explorer.js";

export const LATE_GRACE_MS = 10 * 60 * 1000;
/** Allowed lag of a block timestamp behind the session creation time. */
export const NOT_BEFORE_SKEW_MS = 5 * 60 * 1000;
export const DEFAULT_ZCASH_MIN_CONFIRMATIONS = 3;
const TXID_RE = /^[0-9a-f]{64}$/;

export interface VerifyZcashParams {
  txid: string;
  payTo: string;
  expectedZats: bigint;
  /** Require the received amount to equal `expectedZats` (default true). */
  exact?: boolean;
  minConfirmations?: number;
  /** Earliest acceptable block time. */
  notBefore: Date;
  /** Quote expiry; payments mined after it + {@link LATE_GRACE_MS} are `late`. */
  quoteExpiresAt: Date;
  /** When set, a transparent input must come from this address. */
  payer?: string;
}

export type ZcashVerification =
  | { status: "confirmed"; confirmations: number; receivedZats: bigint }
  | { status: "pending"; reason: string; retryLater: boolean; confirmations: number }
  | { status: "rejected"; reason: string }
  | { status: "late"; reason: string; confirmations: number; receivedZats: bigint };

function pending(reason: string, retryLater = false, confirmations = 0): ZcashVerification {
  return { status: "pending", reason, retryLater, confirmations };
}

/** Verify `params.txid` through `explorer`. Never throws for chain states. */
export async function verifyZcashTransparent(
  explorer: ZcashExplorer,
  params: VerifyZcashParams,
): Promise<ZcashVerification> {
  const txid = params.txid.trim().toLowerCase();
  if (!TXID_RE.test(txid)) return { status: "rejected", reason: "malformed Zcash txid" };

  const lookup = await explorer.getTransaction(txid);
  if (!lookup.ok) return pending(`explorer unavailable: ${lookup.reason}`, lookup.retryLater);
  const tx = lookup.value;
  if (tx === null) return pending("transaction not found yet", true);

  const received = tx.outputs
    .filter((output) => output.recipient === params.payTo)
    .reduce((sum, output) => sum + output.value, 0n);
  if (received === 0n) return { status: "rejected", reason: "transaction has no output to the session address" };
  const exact = params.exact ?? true;
  if (exact ? received !== params.expectedZats : received < params.expectedZats) {
    return {
      status: "rejected",
      reason: `received ${received} zatoshis, expected ${exact ? "exactly" : "at least"} ${params.expectedZats}`,
    };
  }
  if (params.payer !== undefined && !tx.inputAddresses.includes(params.payer)) {
    return { status: "rejected", reason: "transaction was not sent from the declared payer address" };
  }
  if (tx.blockHeight === null || tx.blockTime === null) return pending("transaction is in the mempool", true);

  const minConfirmations = params.minConfirmations ?? DEFAULT_ZCASH_MIN_CONFIRMATIONS;
  if (tx.confirmations < minConfirmations) {
    return pending(`awaiting confirmations: ${tx.confirmations} < ${minConfirmations}`, true, tx.confirmations);
  }
  if (tx.blockTime.getTime() < params.notBefore.getTime() - NOT_BEFORE_SKEW_MS) {
    return { status: "rejected", reason: "transaction was mined before the checkout session was created" };
  }
  if (tx.blockTime.getTime() > params.quoteExpiresAt.getTime() + LATE_GRACE_MS) {
    return {
      status: "late",
      reason: "payment arrived after the quote expired; held for manual review",
      confirmations: tx.confirmations,
      receivedZats: received,
    };
  }
  return { status: "confirmed", confirmations: tx.confirmations, receivedZats: received };
}
