/**
 * Settlement reconciliation: advance submitted receipts to `settled` once the
 * chain confirms them. This is the core logic the settlement worker runs on a
 * schedule (in apps/worker) against the Arc indexer; kept pure here so it is
 * fully testable and reused across the worker and the facilitator.
 */

import { toIso } from "@settlekit/common";
import type { SettlementReceipt } from "./types.js";

/** Minimal confirmation lookup (implemented by the Arc indexer client). */
export interface ConfirmationSource {
  /** Confirmations for a tx hash, or null if not yet indexed. */
  confirmations(txHash: string): Promise<number | null>;
}

export interface ReconcileOptions {
  minConfirmations?: number;
  now?: () => Date;
}

/** Reconcile a single receipt; returns a settled copy when confirmed, else the
 * receipt unchanged. Terminal receipts (settled/failed) and receipts without a
 * tx hash are returned as-is. */
export async function reconcileReceipt(
  receipt: SettlementReceipt,
  source: ConfirmationSource,
  options: ReconcileOptions = {},
): Promise<SettlementReceipt> {
  if (receipt.status === "settled" || receipt.status === "failed") {
    return receipt;
  }
  if (receipt.txHash === undefined || receipt.txHash.length === 0) {
    return receipt;
  }
  const confirmations = await source.confirmations(receipt.txHash);
  if (confirmations === null) {
    return receipt;
  }
  if (confirmations >= (options.minConfirmations ?? 1)) {
    const now = options.now ?? (() => new Date());
    return { ...receipt, status: "settled", settledAt: toIso(now()) };
  }
  return receipt;
}

/** A reconciled receipt and whether it changed this pass. */
export interface ReconcileResult {
  receipt: SettlementReceipt;
  changed: boolean;
}

/** Reconcile a batch of receipts. */
export async function reconcileReceipts(
  receipts: readonly SettlementReceipt[],
  source: ConfirmationSource,
  options: ReconcileOptions = {},
): Promise<ReconcileResult[]> {
  const results: ReconcileResult[] = [];
  for (const receipt of receipts) {
    const next = await reconcileReceipt(receipt, source, options);
    results.push({ receipt: next, changed: next.status !== receipt.status });
  }
  return results;
}
