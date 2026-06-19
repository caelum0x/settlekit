/**
 * Idempotency + nonce stores. In-memory implementations here; Postgres-backed
 * versions live in @settlekit/persistence so settlement survives restarts.
 */

import { conflict, generateSecret, money, toIso, uuid } from "@settlekit/common";
import type {
  IdempotencyStore,
  NonceStore,
  SettlementProviderName,
  SettlementReceipt,
  SettlementReceiptStore,
  SettlementRequest,
  SettlementStatus,
} from "./types.js";

/** Build a settlement receipt id. */
export function settlementId(): string {
  return `stl_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * The placeholder receipt written when a reference is first claimed via
 * {@link IdempotencyStore.reserve}. {@link withIdempotency} upgrades it to the
 * real receipt on success or releases it on failure.
 */
function pendingReceipt(
  request: SettlementRequest,
  provider: SettlementProviderName,
): SettlementReceipt {
  return {
    id: settlementId(),
    reference: request.reference,
    to: request.to,
    amount: money(request.amountUsdc),
    network: request.network,
    status: "pending",
    provider,
    createdAt: toIso(new Date()),
  };
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly byReference = new Map<string, SettlementReceipt>();

  async get(reference: string): Promise<SettlementReceipt | undefined> {
    return this.byReference.get(reference);
  }

  async put(receipt: SettlementReceipt): Promise<void> {
    this.byReference.set(receipt.reference, receipt);
  }

  // Atomic by construction: JS runs this synchronously to completion, so there
  // is no await between the has() check and the set() that could interleave.
  async reserve(pending: SettlementReceipt): Promise<boolean> {
    if (this.byReference.has(pending.reference)) return false;
    this.byReference.set(pending.reference, pending);
    return true;
  }

  async release(reference: string): Promise<void> {
    if (this.byReference.get(reference)?.status === "pending") {
      this.byReference.delete(reference);
    }
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

  async reserve(pending: SettlementReceipt): Promise<boolean> {
    if (this.byReference.has(pending.reference)) return false;
    this.byReference.set(pending.reference, pending);
    return true;
  }

  async release(reference: string): Promise<void> {
    if (this.byReference.get(reference)?.status === "pending") {
      this.byReference.delete(reference);
    }
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
 *
 * Concurrency safety: a naive get()-then-settle() check is a TOCTOU race — two
 * simultaneous requests with the same reference both see "not settled" and both
 * transfer, double-spending. So when the store supports an atomic
 * {@link IdempotencyStore.reserve}, exactly one concurrent caller wins the
 * claim and runs settle(); the rest return the recorded receipt or, if the
 * winner is still in flight, a retryable conflict. A settle() that throws
 * releases the claim so the reference can be retried.
 */
export async function withIdempotency(
  store: IdempotencyStore,
  request: SettlementRequest,
  provider: SettlementProviderName,
  settle: () => Promise<SettlementReceipt>,
): Promise<SettlementReceipt> {
  const existing = await store.get(request.reference);
  if (existing !== undefined && existing.status !== "pending") {
    return existing;
  }

  // Atomically claim the reference so only one concurrent caller settles it.
  if (store.reserve) {
    const won = existing === undefined ? await store.reserve(pendingReceipt(request, provider)) : false;
    if (!won) {
      const after = await store.get(request.reference);
      if (after !== undefined && after.status !== "pending") return after;
      throw conflict(`settlement for reference ${request.reference} is already in progress`, {
        reference: request.reference,
      });
    }
  }

  try {
    const receipt = await settle();
    await store.put(receipt);
    return receipt;
  } catch (error) {
    // Release a *pending* claim so a retry of a failed settlement can proceed.
    await store.release?.(request.reference);
    throw error;
  }
}
