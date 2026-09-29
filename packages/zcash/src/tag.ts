/**
 * Per-session amount tags.
 *
 * Transparent Zcash addresses cannot carry a memo, so several open sessions
 * paying the same merchant address are told apart by a unique zatoshi tag
 * added to the quoted amount: tag = sha256(sessionId) mod 10000, bumped past
 * tags already held by other open sessions on the same payTo.
 */

import { sha256, stringToBytes } from "viem";

export const TAG_MODULUS = 10_000;

/** The unbumped tag for a session id. */
export function baseTag(sessionId: string): number {
  const digest = BigInt(sha256(stringToBytes(sessionId)));
  return Number(digest % BigInt(TAG_MODULUS));
}

/**
 * A tag for `sessionId` not present in `taken`. Throws when every tag is in
 * use (10 000 concurrently open sessions on one address).
 */
export function assignTag(sessionId: string, taken: ReadonlySet<number>): number {
  const start = baseTag(sessionId);
  for (let offset = 0; offset < TAG_MODULUS; offset += 1) {
    const candidate = (start + offset) % TAG_MODULUS;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("no free Zcash amount tag: too many open sessions on this address");
}
