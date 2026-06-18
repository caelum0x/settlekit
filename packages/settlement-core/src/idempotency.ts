/**
 * Idempotency + nonce stores. In-memory implementations here; Postgres-backed
 * versions live in @settlekit/persistence so settlement survives restarts.
 */

import { generateSecret, uuid } from "@settlekit/common";
import type {
  IdempotencyStore,
  NonceStore,
  SettlementReceipt,
  SettlementReceiptStore,
  SettlementStatus,
} from "./types.js";

/** Build a settlement receipt id. */
export function settlementId(): string {
  return `stl_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly byReference = new Map<string, SettlementReceipt>();

  async get(reference: string): Promise<SettlementReceipt | undefined> {
    return this.byReference.get(reference);
  }

  async put(receipt: SettlementReceipt): Promise<void> {
    this.byReference.set(receipt.reference, receipt);
  }
}

/** In-memory queryable receipt store (dev/tests). */
export class InMemorySettlementReceiptStore implements SettlementReceiptStore {
  private readonly byReference = new Map<string, SettlementReceipt>();

  async get(reference: string): Promise<SettlementReceipt | undefined> {
    return this.byReference.get(reference);
  }

  async put(receipt: SettlementReceipt): Promise<void> {
    this.byReference.set(receipt.reference, receipt);
  }

  async listByStatus(status: SettlementStatus): Promise<SettlementReceipt[]> {
    return [...this.byReference.values()].filter((r) => r.status === status);
  }
}

export class InMemoryNonceStore implements NonceStore {
  private readonly live = new Set<string>();

  async issue(): Promise<string> {
    const nonce = generateSecret(16);
    this.live.add(nonce);
    return nonce;
  }

  async consume(nonce: string): Promise<boolean> {
    return this.live.delete(nonce);
  }
}

/**
 * Wrap a provider's settle() with idempotency: a repeated `reference` returns
 * the stored receipt instead of issuing a second transfer.
 */
export async function withIdempotency(
  store: IdempotencyStore,
  request: { reference: string },
  settle: () => Promise<SettlementReceipt>,
): Promise<SettlementReceipt> {
  const existing = await store.get(request.reference);
  if (existing !== undefined) {
    return existing;
  }
  const receipt = await settle();
  await store.put(receipt);
  return receipt;
}
