/**
 * Locate a session's payment among recent activity on its payTo address by
 * exact amount (quote + tag), using ONE address call. The match is then
 * re-verified with {@link verifyZcashTransparent} before anything settles.
 */

import type { ExplorerResult, ZcashAddressActivity, ZcashExplorer } from "./explorer.js";

export const DEFAULT_ACTIVITY_LIMIT = 50;

export interface FindZcashPaymentParams {
  expectedZats: bigint;
  /** Earliest acceptable block time; mempool entries are always candidates. */
  notBefore: Date;
}

/** Pick the oldest activity entry matching `params` (pure). */
export function matchZcashPayment(
  activity: readonly ZcashAddressActivity[],
  params: FindZcashPaymentParams,
): ZcashAddressActivity | null {
  const matches = activity.filter(
    (entry) =>
      entry.balanceChange === params.expectedZats &&
      (entry.blockTime === null || entry.blockTime.getTime() >= params.notBefore.getTime()),
  );
  return matches.length > 0 ? (matches[matches.length - 1] ?? null) : null;
}

/** Fetch recent activity for `payTo` and find the session's payment. */
export async function findZcashPayment(
  explorer: ZcashExplorer,
  payTo: string,
  params: FindZcashPaymentParams,
  limit = DEFAULT_ACTIVITY_LIMIT,
): Promise<ExplorerResult<ZcashAddressActivity | null>> {
  const activity = await explorer.getAddressActivity(payTo, limit);
  if (!activity.ok) return activity;
  return { ok: true, value: matchZcashPayment(activity.value, params) };
}
