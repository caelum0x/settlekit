/**
 * Batch accumulator: collect many tiny settlements to the same recipient and
 * flush them as one transfer per (recipient, network). This is what makes
 * sub-cent nanopayments economical — thousands of leptons settle in one go.
 * Combined with the Gateway provider's native batching, fees stay negligible.
 */

import { createHash } from "node:crypto";
import { type Money, fromBaseUnits, money, toBaseUnits } from "@settlekit/common";
import type { SettlementProvider, SettlementReceipt, SettlementRequest } from "./types.js";

interface Group {
  to: string;
  network: SettlementRequest["network"];
  totalBase: bigint;
  references: string[];
}

export class BatchAccumulator {
  private readonly provider: SettlementProvider;
  private readonly groups = new Map<string, Group>();

  constructor(provider: SettlementProvider) {
    this.provider = provider;
  }

  /** Queue a settlement for the next flush. */
  add(request: SettlementRequest): void {
    const key = `${request.network}|${request.to.toLowerCase()}`;
    const group = this.groups.get(key);
    const amountBase = toBaseUnits(money(request.amountUsdc).amount);
    if (group === undefined) {
      this.groups.set(key, {
        to: request.to,
        network: request.network,
        totalBase: amountBase,
        references: [request.reference],
      });
    } else {
      group.totalBase += amountBase;
      group.references.push(request.reference);
    }
  }

  /** Number of distinct (recipient, network) groups pending. */
  size(): number {
    return this.groups.size;
  }

  /** Total value queued across all groups. */
  pendingTotal(): Money {
    let total = 0n;
    for (const group of this.groups.values()) {
      total += group.totalBase;
    }
    return money(fromBaseUnits(total));
  }

  /**
   * Settle every pending group (one transfer each) and clear the buffer. The
   * combined reference is deterministic over the member references, so a
   * re-flush of the same set is idempotent at the provider.
   */
  async flush(referencePrefix = "batch"): Promise<SettlementReceipt[]> {
    const receipts: SettlementReceipt[] = [];
    for (const group of this.groups.values()) {
      const sortedRefs = [...group.references].sort();
      // Digest the member references rather than joining them with a delimiter:
      // a raw join (",") collides for distinct sets when a reference itself
      // contains the delimiter (["a","b,c"] and ["a,b","c"] both → "a,b,c"),
      // and that combined string is the provider idempotency key — a collision
      // would dedupe a genuine batch and leave a recipient unpaid. JSON-encoding
      // before hashing is unambiguous, so distinct sets never collide.
      const digest = createHash("sha256")
        .update(JSON.stringify(sortedRefs))
        .digest("hex")
        .slice(0, 32);
      const reference = `${referencePrefix}:${group.network}:${group.to.toLowerCase()}:${sortedRefs.length}:${digest}`;
      const receipt = await this.provider.settle({
        reference,
        to: group.to,
        amountUsdc: fromBaseUnits(group.totalBase),
        network: group.network,
      });
      receipts.push(receipt);
    }
    this.groups.clear();
    return receipts;
  }
}
