/**
 * In-memory settlement provider for tests and local development. Records each
 * settlement and exposes aggregate volume — never touches a chain.
 */

import { type Money, addMoney, money, toIso } from "@settlekit/common";
import { InMemoryIdempotencyStore, settlementId, withIdempotency } from "./idempotency.js";
import type {
  IdempotencyStore,
  SettlementProvider,
  SettlementReceipt,
  SettlementRequest,
} from "./types.js";

export class LocalSettlementProvider implements SettlementProvider {
  readonly name = "local" as const;
  private readonly idempotency: IdempotencyStore;
  private readonly receipts: SettlementReceipt[] = [];

  constructor(idempotency: IdempotencyStore = new InMemoryIdempotencyStore()) {
    this.idempotency = idempotency;
  }

  async settle(request: SettlementRequest): Promise<SettlementReceipt> {
    return withIdempotency(this.idempotency, request, "local", async () => {
      const now = toIso(new Date());
      const receipt: SettlementReceipt = {
        id: settlementId(),
        reference: request.reference,
        to: request.to,
        amount: money(request.amountUsdc),
        network: request.network,
        status: "settled",
        provider: "local",
        txHash: `0xlocal${settlementId().slice(4)}`,
        createdAt: now,
        settledAt: now,
      };
      this.receipts.push(receipt);
      return receipt;
    });
  }

  all(): readonly SettlementReceipt[] {
    return [...this.receipts];
  }

  totalVolume(): Money {
    return this.receipts.reduce<Money>((sum, r) => addMoney(sum, r.amount), money("0"));
  }
}
