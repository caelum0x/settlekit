import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore, withIdempotency } from "../src/idempotency.js";
import type { SettlementReceipt, SettlementRequest } from "../src/types.js";

const req: SettlementRequest = {
  reference: "ref-concurrent",
  to: "0xrecipient",
  amountUsdc: "1.25",
  network: "arc",
};

function receiptFor(): SettlementReceipt {
  return {
    id: `stl_${Math.random().toString(16).slice(2)}`,
    reference: req.reference,
    to: req.to,
    amount: { amount: req.amountUsdc, currency: "USDC" },
    network: req.network,
    status: "settled",
    provider: "local",
    txHash: "0xabc",
    createdAt: new Date().toISOString(),
    settledAt: new Date().toISOString(),
  };
}

/** A settle() that yields to the event loop, so two callers can interleave. */
function slowSettle(counter: { n: number }): () => Promise<SettlementReceipt> {
  return async () => {
    counter.n += 1;
    await new Promise((r) => setTimeout(r, 5));
    return receiptFor();
  };
}

describe("withIdempotency concurrency", () => {
  it("runs settle() exactly once for concurrent identical references", async () => {
    const store = new InMemoryIdempotencyStore();
    const counter = { n: 0 };

    const results = await Promise.allSettled([
      withIdempotency(store, req, "local", slowSettle(counter)),
      withIdempotency(store, req, "local", slowSettle(counter)),
      withIdempotency(store, req, "local", slowSettle(counter)),
    ]);

    // The whole point: the money only moves once, no matter how many race.
    expect(counter.n).toBe(1);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    // Any caller that did not win the claim must conflict, never double-settle.
    for (const r of results) {
      if (r.status === "rejected") {
        expect(String(r.reason)).toMatch(/already in progress/i);
      }
    }
  });

  it("returns the recorded receipt on a sequential retry (no second settle)", async () => {
    const store = new InMemoryIdempotencyStore();
    const counter = { n: 0 };

    const first = await withIdempotency(store, req, "local", slowSettle(counter));
    const second = await withIdempotency(store, req, "local", slowSettle(counter));

    expect(counter.n).toBe(1);
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("settled");
  });

  it("releases the claim when settle() fails so a retry can proceed", async () => {
    const store = new InMemoryIdempotencyStore();

    await expect(
      withIdempotency(store, req, "local", async () => {
        throw new Error("transfer boom");
      }),
    ).rejects.toThrow(/boom/);

    // Claim released: the reference is retryable and now settles cleanly.
    const counter = { n: 0 };
    const ok = await withIdempotency(store, req, "local", slowSettle(counter));
    expect(counter.n).toBe(1);
    expect(ok.status).toBe("settled");
  });
});
