import { isErr, isOk } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import {
  CpnOffRampProvider,
  type CpnHttpClient,
  type CpnPayoutResponse,
} from "../src/cpn-provider.js";
import { InMemoryPayoutStore, withPayoutIdempotency } from "../src/idempotency.js";
import type { PayoutReceipt, PayoutRequest } from "../src/types.js";

const req: PayoutRequest = {
  reference: "ref-concurrent",
  amountUsdc: "1.25",
  destinationCurrency: "USD",
  payoutMethod: "bank_account",
  beneficiary: { name: "A", country: "US", accountNumber: "123" },
};

function receiptFor(): PayoutReceipt {
  return {
    id: `po_${Math.random().toString(16).slice(2)}`,
    reference: req.reference,
    amount: { amount: req.amountUsdc, currency: "USDC" },
    destinationCurrency: "USD",
    destinationAmount: "1.24",
    status: "paid",
    provider: "local",
    cpnTransferId: "cpn_x",
    createdAt: new Date().toISOString(),
    settledAt: new Date().toISOString(),
  };
}

/** A pay() that yields to the event loop, so two callers can interleave. */
function slowPay(counter: { n: number }) {
  return async () => {
    counter.n += 1;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true as const, value: receiptFor() };
  };
}

describe("withPayoutIdempotency concurrency", () => {
  it("runs pay() exactly once for concurrent identical references", async () => {
    const store = new InMemoryPayoutStore();
    const counter = { n: 0 };

    const results = await Promise.all([
      withPayoutIdempotency(store, req, "local", slowPay(counter)),
      withPayoutIdempotency(store, req, "local", slowPay(counter)),
      withPayoutIdempotency(store, req, "local", slowPay(counter)),
    ]);

    // The money only moves once, no matter how many race.
    expect(counter.n).toBe(1);
    const okCount = results.filter(isOk).length;
    expect(okCount).toBeGreaterThanOrEqual(1);
    // Losers either got the recorded receipt or a retryable conflict — never a
    // second payout.
    for (const r of results) {
      if (isErr(r)) expect(r.error.code).toBe("conflict");
    }
  });

  it("returns the recorded receipt on a sequential retry (no second pay)", async () => {
    const store = new InMemoryPayoutStore();
    const counter = { n: 0 };
    const first = await withPayoutIdempotency(store, req, "local", slowPay(counter));
    const second = await withPayoutIdempotency(store, req, "local", slowPay(counter));

    expect(counter.n).toBe(1);
    expect(isOk(first)).toBe(true);
    expect(isOk(second)).toBe(true);
    if (isOk(first) && isOk(second)) expect(second.value.id).toBe(first.value.id);
  });

  it("releases the claim when pay() throws so a retry can proceed", async () => {
    const store = new InMemoryPayoutStore();
    await expect(
      withPayoutIdempotency(store, req, "local", async () => {
        throw new Error("transfer boom");
      }),
    ).rejects.toThrow(/boom/);

    const counter = { n: 0 };
    const retry = await withPayoutIdempotency(store, req, "local", slowPay(counter));
    expect(counter.n).toBe(1);
    expect(isOk(retry)).toBe(true);
  });

  it("CpnOffRampProvider with a delayed client transfers once under concurrency", async () => {
    let calls = 0;
    const http: CpnHttpClient = {
      requestQuote: async () => {
        throw new Error("not used");
      },
      createPayout: async (input): Promise<CpnPayoutResponse> => {
        calls += 1;
        await new Promise((r) => setTimeout(r, 5));
        return { transferId: `cpn_${input.idempotencyKey}`, status: "paid", destinationAmount: "1.24" };
      },
    };
    const provider = new CpnOffRampProvider({
      credentials: { apiKey: "sk", baseUrl: "https://api.circle.com" },
      http,
    });

    const results = await Promise.all([
      provider.initiatePayout(req),
      provider.initiatePayout(req),
    ]);

    expect(calls).toBe(1);
    for (const r of results) {
      if (isErr(r)) expect(r.error.code).toBe("conflict");
    }
    expect(results.some(isOk)).toBe(true);
  });
});
