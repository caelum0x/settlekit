import { describe, expect, it } from "vitest";
import { toBaseUnits } from "@settlekit/common";
import { createLocalSettlement } from "@settlekit/x402-client";
import { conservedAllocation } from "../src/conservation.js";
import { buildGraph, computeReach } from "../src/graph.js";
import { parsePackageJson, parsePackageLock, parseRequirementsTxt } from "../src/manifest.js";
import { planFunding } from "../src/plan.js";
import { RegistryMaintainerResolver } from "../src/resolver.js";
import {
  SEED_ESCROW_WALLET,
  seedLockJson,
  seedMaintainers,
  seedManifestJson,
  seedRegistry,
} from "../src/seed.js";
import { settleFundingPlan, toDistributorCall } from "../src/settle.js";

async function seededPlan(budget = "5") {
  const graph = buildGraph(parsePackageJson(seedManifestJson()), parsePackageLock(seedLockJson()));
  const registry = await seedRegistry();
  const resolver = new RegistryMaintainerResolver(registry, {
    escrowWallet: SEED_ESCROW_WALLET,
    maintainers: seedMaintainers(),
  });
  const plan = await planFunding({ graph, budgetUsdc: budget, resolver });
  return plan;
}

describe("conservedAllocation", () => {
  it("distributes every base unit and sums exactly to the total", () => {
    const total = 1_000_003n;
    const out = conservedAllocation([3, 1, 1, 0.5, 0.0001], total);
    expect(out.reduce((s, v) => s + v, 0n)).toBe(total);
    expect(out.every((v) => v >= 0n)).toBe(true);
  });

  it("falls back to an even split when all weights are zero", () => {
    const out = conservedAllocation([0, 0, 0, 0], 100n);
    expect(out.reduce((s, v) => s + v, 0n)).toBe(100n);
    expect(out).toEqual([25n, 25n, 25n, 25n]);
  });

  it("gives the larger share to the larger weight", () => {
    const out = conservedAllocation([9, 1], 1_000_000n);
    expect(out[0]).toBeGreaterThan(out[1] as bigint);
    expect((out[0] as bigint) + (out[1] as bigint)).toBe(1_000_000n);
  });
});

describe("manifest parsing", () => {
  it("classifies npm dependency kinds, with prod winning conflicts", () => {
    const parsed = parsePackageJson(
      JSON.stringify({
        name: "x",
        dependencies: { react: "^18", shared: "^1" },
        devDependencies: { vitest: "^2", shared: "^1" },
      }),
    );
    const byName = new Map(parsed.direct.map((d) => [d.name, d.kind]));
    expect(byName.get("react")).toBe("prod");
    expect(byName.get("vitest")).toBe("dev");
    expect(byName.get("shared")).toBe("prod");
  });

  it("parses requirements.txt, skipping comments and options", () => {
    const parsed = parseRequirementsTxt("# c\nrequests==2.31.0\nflask>=3\n-r dev.txt\n");
    expect(parsed.ecosystem).toBe("pypi");
    expect(parsed.direct.map((d) => d.name).sort()).toEqual(["flask", "requests"]);
  });
});

describe("graph + criticality", () => {
  it("computes transitive reach for load-bearing packages", () => {
    const graph = buildGraph(parsePackageJson(seedManifestJson()), parsePackageLock(seedLockJson()));
    const reach = computeReach(graph);
    // loose-envify is depended on by react, react-dom, and scheduler.
    expect(reach.get("loose-envify") ?? 0).toBeGreaterThanOrEqual(3);
    // a direct leaf with no dependents has zero reach.
    expect(reach.get("is-number") ?? 0).toBe(0);
  });
});

describe("planFunding allocation", () => {
  it("conserves the budget across per-package and per-wallet views", async () => {
    const plan = await seededPlan("5");
    const allocSum = plan.allocations.reduce((s, a) => s + toBaseUnits(a.amount.amount), 0n);
    const legSum = plan.legs.reduce((s, l) => s + toBaseUnits(l.amount.amount), 0n);
    expect(allocSum).toBe(toBaseUnits("5"));
    expect(legSum).toBe(toBaseUnits("5"));
  });

  it("funds an underfunded critical package above a well-funded leaf", async () => {
    const plan = await seededPlan("5");
    const find = (name: string) =>
      toBaseUnits(plan.allocations.find((a) => a.name === name)?.amount.amount ?? "0");
    // loose-envify: load-bearing + unfunded; typescript: a leaf maintained by a
    // $50k/mo org. The allocator should prefer the former.
    expect(find("loose-envify")).toBeGreaterThan(find("typescript"));
  });

  it("rejects a negative budget", async () => {
    const graph = buildGraph(parsePackageJson(seedManifestJson()), parsePackageLock(seedLockJson()));
    const resolver = new RegistryMaintainerResolver(await seedRegistry(), {
      escrowWallet: SEED_ESCROW_WALLET,
      maintainers: seedMaintainers(),
    });
    await expect(planFunding({ graph, budgetUsdc: "-5", resolver })).rejects.toThrow(/non-negative/);
  });

  it("earmarks unregistered maintainers to the escrow wallet", async () => {
    const plan = await seededPlan("5");
    const escrowLeg = plan.legs.find((l) => l.wallet === SEED_ESCROW_WALLET);
    expect(escrowLeg).toBeDefined();
    expect(escrowLeg?.claimed).toBe(false);
    expect(toBaseUnits(plan.unclaimed.amount)).toBe(toBaseUnits(escrowLeg?.amount.amount ?? "0"));
  });
});

describe("settlement", () => {
  it("settles every leg and reconciles to the budget", async () => {
    const plan = await seededPlan("5");
    const { settler } = createLocalSettlement();
    const receipt = await settleFundingPlan(plan, { settler, from: "0xfunder" });
    expect(receipt.settlements.length).toBe(plan.legs.length);
    expect(receipt.distributed.amount).toBe("5");
    expect(receipt.reconciled).toBe(true);
  });

  it("produces a conserved on-chain distributor call", async () => {
    const plan = await seededPlan("5");
    const call = toDistributorCall(plan);
    expect(call.recipients.length).toBe(call.amounts.length);
    const sum = call.amounts.reduce((s, a) => s + BigInt(a), 0n);
    expect(call.totalBase).toBe(toBaseUnits("5").toString());
    expect(sum).toBe(toBaseUnits("5"));
  });
});
