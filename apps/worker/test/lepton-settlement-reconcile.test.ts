import { describe, expect, it } from "vitest";
import { money } from "@settlekit/common";
import {
  InMemorySettlementReceiptStore,
  type ConfirmationSource,
  type SettlementReceipt,
} from "@settlekit/settlement-core";
import { leptonSettlementReconcileJob } from "../src/jobs/lepton-settlement-reconcile-job.js";
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

const submitted = (id: string, txHash: string): SettlementReceipt => ({
  id,
  reference: `ref-${id}`,
  to: "0xto",
  amount: money("0.001"),
  network: "arc",
  status: "submitted",
  provider: "gateway",
  txHash,
  createdAt: "2026-06-18T00:00:00.000Z",
});

describe("leptonSettlementReconcileJob", () => {
  it("no-ops when the settlement spine is not wired", async () => {
    const result = await leptonSettlementReconcileJob.run(ctxWith({}));
    expect(result).toEqual({ processed: 0, failed: 0 });
  });

  it("advances confirmed receipts to settled and persists them", async () => {
    const store = new InMemorySettlementReceiptStore();
    await store.put(submitted("stl_1", "0xconfirmed"));
    await store.put(submitted("stl_2", "0xpending"));

    const confirmationSource: ConfirmationSource = {
      confirmations: async (tx) => (tx === "0xconfirmed" ? 5 : null),
    };

    const result = await leptonSettlementReconcileJob.run(
      ctxWith({ settlementStore: store, confirmationSource }),
    );

    expect(result.processed).toBe(1);
    expect((await store.listByStatus("settled"))).toHaveLength(1);
    expect((await store.listByStatus("submitted"))).toHaveLength(1);
  });
});
