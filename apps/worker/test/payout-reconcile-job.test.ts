import { describe, expect, it } from "vitest";
import { money } from "@settlekit/common";
import { InMemoryPayoutStore, type Payout } from "@settlekit/payouts";
import type { JobContext } from "../src/jobs/types.js";
import { payoutReconcileJob } from "../src/jobs/payout-reconcile-job.js";

/** Minimal JobContext — the job only touches these four fields. */
function ctxWith(
  payoutStore: InMemoryPayoutStore,
  walletsClient: { getTransaction: (id: string) => Promise<unknown> } | null,
): JobContext {
  return {
    payoutStore,
    walletsClient,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  } as unknown as JobContext;
}

function payout(over: Partial<Payout>): Payout {
  return {
    id: "po_1",
    organizationId: "org_1",
    walletAddress: "0xMerchant",
    amount: money("10"),
    network: "arc",
    status: "pending",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("payoutReconcileJob", () => {
  it("is a no-op when Circle wallets are unconfigured", async () => {
    const store = new InMemoryPayoutStore();
    await store.save(payout({ providerRef: "tx_1" }));
    expect(await payoutReconcileJob.run(ctxWith(store, null))).toEqual({ processed: 0, failed: 0 });
    expect((await store.findById("po_1"))?.status).toBe("pending");
  });

  it("marks paid when the provider transfer now has an on-chain hash", async () => {
    const store = new InMemoryPayoutStore();
    await store.save(payout({ providerRef: "tx_1" }));
    const wallets = { getTransaction: async (id: string) => ({ id, state: "COMPLETE", txHash: "0xfeed" }) };
    const result = await payoutReconcileJob.run(ctxWith(store, wallets));
    expect(result.processed).toBe(1);
    const settled = await store.findById("po_1");
    expect(settled?.status).toBe("paid");
    expect(settled?.txHash).toBe("0xfeed");
    expect(settled?.providerRef).toBe("tx_1");
  });

  it("marks failed on a terminal provider state", async () => {
    const store = new InMemoryPayoutStore();
    await store.save(payout({ id: "po_2", providerRef: "tx_2" }));
    const wallets = { getTransaction: async (id: string) => ({ id, state: "FAILED" }) };
    await payoutReconcileJob.run(ctxWith(store, wallets));
    const failed = await store.findById("po_2");
    expect(failed?.status).toBe("failed");
  });

  it("leaves an in-flight transfer pending for a later tick", async () => {
    const store = new InMemoryPayoutStore();
    await store.save(payout({ id: "po_3", providerRef: "tx_3" }));
    const wallets = { getTransaction: async (id: string) => ({ id, state: "INITIATED" }) };
    const result = await payoutReconcileJob.run(ctxWith(store, wallets));
    expect(result.processed).toBe(0);
    expect((await store.findById("po_3"))?.status).toBe("pending");
  });

  it("skips payouts that were never executed (no providerRef)", async () => {
    const store = new InMemoryPayoutStore();
    await store.save(payout({ id: "po_4" }));
    let called = false;
    const wallets = {
      getTransaction: async (id: string) => {
        called = true;
        return { id, state: "COMPLETE", txHash: "0x" };
      },
    };
    await payoutReconcileJob.run(ctxWith(store, wallets));
    expect(called).toBe(false);
    expect((await store.findById("po_4"))?.status).toBe("pending");
  });
});
