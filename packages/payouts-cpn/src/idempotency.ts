/**
 * Idempotency for fiat off-ramp payouts. In-memory implementation here;
 * Postgres-backed versions would live in @settlekit/persistence so payouts
 * survive restarts. Shape mirrors settlement-core's InMemoryIdempotencyStore /
 * withIdempotency so the TOCTOU-safe reserve/release semantics are identical.
 */

import { type Result, conflict, err, money, ok, toIso, uuid } from "@settlekit/common";
import type {
  OffRampProviderName,
  PayoutReceipt,
  PayoutRequest,
  PayoutStore,
} from "./types.js";

/** Build a payout receipt id. */
export function payoutId(): string {
  return `po_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

/** Build a payout quote id. */
export function quoteId(): string {
  return `poq_${uuid().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * The placeholder receipt written when a reference is first claimed via
 * {@link PayoutStore.reserve}. {@link withPayoutIdempotency} upgrades it to the
 * real receipt on success or releases it on failure.
 */
function pendingReceipt(
  request: PayoutRequest,
  provider: OffRampProviderName,
): PayoutReceipt {
  return {
    id: payoutId(),
    reference: request.reference,
    amount: money(request.amountUsdc),
    destinationCurrency: request.destinationCurrency,
    destinationAmount: "0",
    status: "pending",
    provider,
    createdAt: toIso(new Date()),
  };
}

export class InMemoryPayoutStore implements PayoutStore {
  private readonly byReference = new Map<string, PayoutReceipt>();

  async get(reference: string): Promise<PayoutReceipt | undefined> {
    return this.byReference.get(reference);
  }

  async put(receipt: PayoutReceipt): Promise<void> {
    this.byReference.set(receipt.reference, receipt);
  }

  // Atomic by construction: JS runs this synchronously to completion, so there
  // is no await between the has() check and the set() that could interleave.
  async reserve(pending: PayoutReceipt): Promise<boolean> {
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

/**
 * Wrap a provider's payout with idempotency: a repeated `reference` returns the
 * stored receipt instead of issuing a second payout.
 *
 * Concurrency safety: a naive get()-then-pay() check is a TOCTOU race — two
 * simultaneous requests with the same reference both see "not paid" and both
 * pay out, double-spending. So when the store supports an atomic
 * {@link PayoutStore.reserve}, exactly one concurrent caller wins the claim and
 * runs `pay()`; the rest return the recorded receipt or, if the winner is still
 * in flight, a retryable conflict. A `pay()` that returns `err`/throws releases
 * the claim so the reference can be retried.
 *
 * Returns a {@link Result} so business failures from `pay()` propagate without
 * throwing, consistent with {@link OffRampProvider}.
 */
export async function withPayoutIdempotency(
  store: PayoutStore,
  request: PayoutRequest,
  provider: OffRampProviderName,
  pay: () => Promise<Result<PayoutReceipt>>,
): Promise<Result<PayoutReceipt>> {
  const existing = await store.get(request.reference);
  if (existing !== undefined && existing.status !== "pending") {
    return ok(existing);
  }

  // Atomically claim the reference so only one concurrent caller pays it out.
  if (store.reserve) {
    const won =
      existing === undefined ? await store.reserve(pendingReceipt(request, provider)) : false;
    if (!won) {
      const after = await store.get(request.reference);
      if (after !== undefined && after.status !== "pending") return ok(after);
      return err(
        conflict(`payout for reference ${request.reference} is already in progress`, {
          reference: request.reference,
        }),
      );
    }
  }

  try {
    const result = await pay();
    if (!result.ok) {
      // Business failure: release the pending claim so a retry can proceed.
      await store.release?.(request.reference);
      return result;
    }
    await store.put(result.value);
    return result;
  } catch (error) {
    // Release a *pending* claim so a retry of a failed payout can proceed,
    // then re-throw: an unexpected throw is not an expected business failure.
    await store.release?.(request.reference);
    throw error;
  }
}
