import { describe, expect, it } from "vitest";
import { compareMoney, money } from "@settlekit/common";
import { LocalSettlementProvider } from "@settlekit/settlement-core";
import { InMemoryRoyaltyLegStore, type PersistedRoyaltyLeg } from "@settlekit/citation-toll";
import { InMemoryStreamStore, openStream, recordFromStream } from "@settlekit/streaming";
import { leptonPayoutSweepJob } from "../src/jobs/lepton-payout-sweep-job.js";
import { leptonStreamRefundJob } from "../src/jobs/lepton-stream-refund-job.js";
import type { JobContext } from "../src/jobs/types.js";

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as JobContext["logger"];

function ctxWith(over: Partial<JobContext>): JobContext {
  return {
    logger: noopLogger,
    now: () => new Date("2026-06-18T00:00:00Z"),
    ...over,
  } as unknown as JobContext;
}

const leg = (id: string, wallet: string, amount: string): PersistedRoyaltyLeg => ({
  id,
  sourceId: "src_1",
  accessId: "acc_1",
  wallet,
  network: "arc",
  amount: money(amount),
  depth: 0,
  status: "pending",
  createdAt: "2026-06-18T00:00:00.000Z",
});

describe("leptonPayoutSweepJob", () => {
  it("no-ops without a settlement provider", async () => {
    const result = await leptonPayoutSweepJob.run(ctxWith({ royaltyLegStore: new InMemoryRoyaltyLegStore() }));
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it("batches pending legs per wallet, settles, and marks them settled", async () => {
    const royaltyLegStore = new InMemoryRoyaltyLegStore();
    await royaltyLegStore.append(leg("l1", "0xAuthor1", "0.0003"));
    await royaltyLegStore.append(leg("l2", "0xAuthor1", "0.0002")); // same wallet -> one transfer
    await royaltyLegStore.append(leg("l3", "0xAuthor2", "0.0005"));
    const provider = new LocalSettlementProvider();

    const result = await leptonPayoutSweepJob.run(
      ctxWith({ royaltyLegStore, settlementProvider: provider }),
    );

    expect(result.processed).toBe(3); // all 3 legs marked settled
    expect(await royaltyLegStore.listPending()).toHaveLength(0);
    // Two recipients => two batched settlements.
    expect(provider.all()).toHaveLength(2);
    const author1 = provider.all().find((r) => r.to === "0xAuthor1");
    expect(author1 && compareMoney(author1.amount, money("0.0005"))).toBe(0);
  });
});

describe("leptonStreamRefundJob", () => {
  it("refunds the reserved-but-unused balance of stopped streams", async () => {
    const streamStore = new InMemoryStreamStore();
    let t = 0;
    const stream = openStream({
      payer: "0xViewer",
      payee: "0xStreamer",
      network: "arc",
      ratePerSecondUsdc: "0.001",
      reserveUsdc: "0.01",
      now: () => t,
    });
    t = 3000; // accrue 0.003 of 0.01
    stream.stop();
    await streamStore.save(recordFromStream(stream, new Date("2026-06-18T00:00:00Z")));
    const provider = new LocalSettlementProvider();

    const result = await leptonStreamRefundJob.run(
      ctxWith({ streamStore, settlementProvider: provider }),
    );

    expect(result.processed).toBe(1);
    const refund = provider.all()[0];
    expect(refund?.to).toBe("0xViewer");
    expect(refund && compareMoney(refund.amount, money("0.007"))).toBe(0); // 0.01 - 0.003
    expect((await streamStore.findById(stream.id))?.refundedAt).toBeDefined();

    // Idempotent: a second run does not refund again.
    const second = await leptonStreamRefundJob.run(
      ctxWith({ streamStore, settlementProvider: provider }),
    );
    expect(second.processed).toBe(0);
  });
});
