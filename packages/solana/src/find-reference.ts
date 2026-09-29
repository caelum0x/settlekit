/**
 * Locate the payment transaction for a Solana Pay reference.
 *
 * `getSignaturesForAddress(reference)` lists every transaction that included
 * the reference key, newest first. The payment is the OLDEST successful one;
 * failed attempts (e.g. a buyer's first try that ran out of SOL) are skipped
 * so a later successful retry is still found.
 */

import type { SolanaFinality } from "./clusters.js";
import type { SignatureInfo, SolanaRpc } from "./rpc.js";

export interface FindReferenceOptions {
  commitment?: SolanaFinality;
  /** Page size (RPC max 1000). */
  pageSize?: number;
  /** Upper bound on pages walked, to cap RPC usage. */
  maxPages?: number;
}

const DEFAULT_PAGE_SIZE = 1_000;
const DEFAULT_MAX_PAGES = 5;

/** Oldest successful signature that references `reference`, or null. */
export async function findReference(
  rpc: SolanaRpc,
  reference: string,
  options: FindReferenceOptions = {},
): Promise<SignatureInfo | null> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const commitment = options.commitment ?? "confirmed";

  let oldest: SignatureInfo | null = null;
  let before: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await rpc.getSignaturesForAddress(reference, {
      limit: pageSize,
      commitment,
      ...(before !== undefined ? { before } : {}),
    });
    for (const row of rows) {
      if (row.err === null || row.err === undefined) oldest = row;
    }
    const last = rows.at(-1);
    if (last === undefined || rows.length < pageSize) break;
    before = last.signature;
  }
  return oldest;
}
