import { describe, expect, it } from "vitest";
import { compareMoney, isErr, isOk, money } from "@settlekit/common";
import { InMemorySourceRegistry, createSource } from "../src/registry.js";
import type { Source } from "../src/types.js";
import {
  NANO_FEE_SCHEDULE,
  computeRoyaltyDistribution,
  distributedTotal,
} from "../src/splits.js";

function src(
  registry: InMemorySourceRegistry,
  input: Parameters<typeof createSource>[0],
): Source {
  const result = createSource(input);
  if (!isOk(result)) throw new Error("createSource failed");
  registry.add(result.value);
  return result.value;
}

describe("createSource validation", () => {
  it("rejects zero price", () => {
    const r = createSource({
      organizationId: "org_1",
      title: "x",
      authorWallet: "0xa",
      priceUsdc: "0",
      body: "b",
    });
    expect(isErr(r)).toBe(true);
  });

  it("rejects citation shares exceeding 100%", () => {
    const r = createSource({
      organizationId: "org_1",
      title: "x",
      authorWallet: "0xa",
      priceUsdc: "0.01",
      body: "b",
      cites: [
        { sourceId: "src_a", shareBps: 6000 },
        { sourceId: "src_b", shareBps: 5000 },
      ],
    });
    expect(isErr(r)).toBe(true);
  });
});

describe("recursive royalty distribution", () => {
  it("splits across a diamond lineage and conserves money", () => {
    const reg = new InMemorySourceRegistry();
    const d = src(reg, { organizationId: "o", title: "D", authorWallet: "0xD", priceUsdc: "0.01", body: "d" });
    const b = src(reg, {
      organizationId: "o", title: "B", authorWallet: "0xB", priceUsdc: "0.01", body: "b",
      cites: [{ sourceId: d.id, shareBps: 5000 }],
    });
    const c = src(reg, {
      organizationId: "o", title: "C", authorWallet: "0xC", priceUsdc: "0.01", body: "c",
      cites: [{ sourceId: d.id, shareBps: 2000 }],
    });
    const a = src(reg, {
      organizationId: "o", title: "A", authorWallet: "0xA", priceUsdc: "1.000000", body: "a",
      cites: [
        { sourceId: b.id, shareBps: 4000 },
        { sourceId: c.id, shareBps: 2000 },
      ],
    });

    const dist = computeRoyaltyDistribution(reg, a.id, NANO_FEE_SCHEDULE);
    expect(dist).toBeDefined();
    if (dist === undefined) return;

    // 2.5% of 1.0 = 0.025 fee, 0.975 distributable
    expect(dist.platformFee.amount).toBe("0.025");
    expect(dist.distributable.amount).toBe("0.975");

    const byWallet = new Map(dist.legs.map((l) => [l.wallet, l.amount]));
    expect(byWallet.get("0xA")?.amount).toBe("0.39"); // keeps 40% of 0.975
    expect(byWallet.get("0xB")?.amount).toBe("0.195"); // 40% of 0.975 * 50%
    expect(byWallet.get("0xC")?.amount).toBe("0.156"); // 20% of 0.975 * 80%
    expect(byWallet.get("0xD")?.amount).toBe("0.234"); // 0.195 (from B) + 0.039 (from C)

    // Conservation: legs sum to distributable.
    expect(compareMoney(distributedTotal(dist), dist.distributable)).toBe(0);
  });

  it("keeps a missing ancestor's share with the citing author", () => {
    const reg = new InMemorySourceRegistry();
    const a = src(reg, {
      organizationId: "o", title: "A", authorWallet: "0xA", priceUsdc: "1.000000", body: "a",
      cites: [{ sourceId: "src_ghost", shareBps: 3000 }],
    });
    const dist = computeRoyaltyDistribution(reg, a.id, NANO_FEE_SCHEDULE);
    if (dist === undefined) throw new Error("no dist");
    // Only the author is paid; the ghost share stays with them.
    expect(dist.legs).toHaveLength(1);
    expect(dist.legs[0]?.wallet).toBe("0xA");
    expect(compareMoney(distributedTotal(dist), dist.distributable)).toBe(0);
  });

  it("is cycle-safe", () => {
    const reg = new InMemorySourceRegistry();
    // Build E and F citing each other (a cycle).
    const e = src(reg, { organizationId: "o", title: "E", authorWallet: "0xE", priceUsdc: "0.50", body: "e" });
    const f = src(reg, {
      organizationId: "o", title: "F", authorWallet: "0xF", priceUsdc: "0.50", body: "f",
      cites: [{ sourceId: e.id, shareBps: 5000 }],
    });
    // Mutate E to cite F (manual cycle) by re-adding.
    reg.add({ ...e, cites: [{ sourceId: f.id, shareBps: 5000 }] });

    const dist = computeRoyaltyDistribution(reg, e.id, NANO_FEE_SCHEDULE);
    if (dist === undefined) throw new Error("no dist");
    expect(compareMoney(distributedTotal(dist), dist.distributable)).toBe(0);
  });

  it("returns undefined for an unknown source", () => {
    const reg = new InMemorySourceRegistry();
    expect(computeRoyaltyDistribution(reg, "src_nope")).toBeUndefined();
  });
});
