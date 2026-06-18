import { describe, expect, it } from "vitest";
import { isOk, money } from "@settlekit/common";
import { createSource } from "../src/registry.js";
import {
  InMemoryRoyaltyLegStore,
  InMemorySourceStore,
  loadSourceRegistry,
  type PersistedRoyaltyLeg,
} from "../src/store.js";
import { computeRoyaltyDistribution } from "../src/splits.js";

function make(input: Parameters<typeof createSource>[0]) {
  const r = createSource(input);
  if (!isOk(r)) throw new Error("createSource failed");
  return r.value;
}

describe("InMemorySourceStore + loadSourceRegistry", () => {
  it("persists sources and snapshots them into a working split registry", async () => {
    const store = new InMemorySourceStore();
    const root = make({ organizationId: "o", title: "Root", authorWallet: "0xR", priceUsdc: "0.01", body: "r" });
    await store.save(root);
    const child = make({
      organizationId: "o", title: "Child", authorWallet: "0xC", priceUsdc: "1.0", body: "c",
      cites: [{ sourceId: root.id, shareBps: 5000 }],
    });
    await store.save(child);

    expect(await store.findById(root.id)).toEqual(root);
    expect(await store.listByOrganization("o")).toHaveLength(2);

    const registry = await loadSourceRegistry(store);
    const dist = computeRoyaltyDistribution(registry, child.id);
    expect(dist).toBeDefined();
    // Root author earns the routed share from the child access.
    const rootLeg = dist?.legs.find((l) => l.wallet === "0xR");
    expect(rootLeg).toBeDefined();
  });
});

describe("InMemoryRoyaltyLegStore", () => {
  it("appends legs and queries by access, wallet, and pending status", async () => {
    const store = new InMemoryRoyaltyLegStore();
    const leg: PersistedRoyaltyLeg = {
      id: "leg_1",
      sourceId: "src_1",
      accessId: "acc_1",
      wallet: "0xAuthor",
      amount: money("0.0004"),
      depth: 0,
      status: "pending",
      createdAt: "2026-06-18T00:00:00.000Z",
    };
    await store.append(leg);
    await store.append({ ...leg, id: "leg_2", wallet: "0xOther", status: "settled" });

    expect(await store.listByAccess("acc_1")).toHaveLength(2);
    expect(await store.listByWallet("0xauthor")).toHaveLength(1);
    expect(await store.listPending()).toHaveLength(1);
  });
});
