import { describe, expect, it } from "vitest";
import { compareMoney, money, toIso } from "@settlekit/common";
import { LocalSettlementProvider } from "@settlekit/settlement-core";
import { InMemoryRoyaltyLegStore, type PersistedRoyaltyLeg } from "../src/store.js";
import { sweepPendingRoyalties } from "../src/sweep.js";

const leg = (id: string, wallet: string, amount: string): PersistedRoyaltyLeg => ({
  id,
  sourceId: "src_1",
  accessId: "acc_1",
  wallet,
  network: "arc",
  amount: money(amount),
  depth: 0,
  status: "pending",
  createdAt: toIso(new Date("2026-06-18T00:00:00Z")),
});

describe("sweepPendingRoyalties", () => {
  it("batches pending legs per wallet into one settlement each", async () => {
    const store = new InMemoryRoyaltyLegStore();
    await store.append(leg("l1", "0xA", "0.0003"));
    await store.append(leg("l2", "0xA", "0.0002"));
    await store.append(leg("l3", "0xB", "0.0005"));
    const provider = new LocalSettlementProvider();

    const result = await sweepPendingRoyalties(store, provider);

    expect(result.processed).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.receipts).toHaveLength(2); // two recipients
    expect(await store.listPending()).toHaveLength(0);
    const toA = provider.all().find((r) => r.to === "0xA");
    expect(toA && compareMoney(toA.amount, money("0.0005"))).toBe(0);
  });

  it("returns zero when nothing is pending", async () => {
    const result = await sweepPendingRoyalties(new InMemoryRoyaltyLegStore(), new LocalSettlementProvider());
    expect(result).toEqual({ processed: 0, failed: 0, receipts: [] });
  });
});
