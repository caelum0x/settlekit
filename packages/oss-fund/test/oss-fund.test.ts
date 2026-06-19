import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toBaseUnits } from "@settlekit/common";
import { InMemoryPayeeRegistry } from "@settlekit/payee-registry";
import { createLocalSettlement, type Settler } from "@settlekit/x402-client";
import { conservedAllocation } from "../src/conservation.js";
import { buildGraph, computeReach } from "../src/graph.js";
import { parsePackageJson, parsePackageLock, parseRequirementsTxt } from "../src/manifest.js";
import { NpmRegistryResolver } from "../src/npm-resolver.js";
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
import { scanUsageCounts } from "../src/usage-scan.js";

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

  it("rejects a settlement whose total conserves but legs are misrouted", async () => {
    const plan = await seededPlan("5");
    const amounts = plan.legs.map((l) => l.amount.amount);
    // Only meaningful when leg amounts differ — the seeded plan is weighted.
    expect(new Set(amounts).size).toBeGreaterThan(1);
    // A settler that rotates each leg's amount onto the next leg: the total still
    // sums to the budget, but no leg is paid its own planned amount.
    let i = 0;
    const misrouting: Settler = {
      async settle({ requirements, from }) {
        const amount = amounts[(i + 1) % amounts.length] as string;
        i += 1;
        return { txHash: `0xrot${i}`, from, amount, network: requirements.network, nonce: requirements.nonce };
      },
    };
    const receipt = await settleFundingPlan(plan, { settler: misrouting, from: "0xfunder" });
    // Total is conserved...
    expect(receipt.distributed.amount).toBe("5");
    // ...but per-leg conservation fails, so the receipt is NOT reconciled.
    expect(receipt.reconciled).toBe(false);
  });

  it("derives stable per-leg nonces from an idempotency key (replay-safe retries)", async () => {
    const plan = await seededPlan("5");
    const capture = (sink: string[]): Settler => ({
      async settle({ requirements, from }) {
        sink.push(requirements.nonce);
        return {
          txHash: `0x${sink.length}`,
          from,
          amount: requirements.amount,
          network: requirements.network,
          nonce: requirements.nonce,
        };
      },
    });

    const a: string[] = [];
    const b: string[] = [];
    await settleFundingPlan(plan, { settler: capture(a), from: "0xfunder", idempotencyKey: "plan-123" });
    await settleFundingPlan(plan, { settler: capture(b), from: "0xfunder", idempotencyKey: "plan-123" });
    // Same plan + same key → identical nonces, so a retry is dedupable, not double-paid.
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // still unique per leg within the plan

    // Without a key, nonces are random and differ run-to-run.
    const c: string[] = [];
    const d: string[] = [];
    await settleFundingPlan(plan, { settler: capture(c), from: "0xfunder" });
    await settleFundingPlan(plan, { settler: capture(d), from: "0xfunder" });
    expect(c).not.toEqual(d);
  });
});

describe("usage scan", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "oss-fund-scan-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "a.ts"), 'import React from "react";\nimport _ from "lodash/merge";\n');
    await writeFile(join(dir, "src", "b.tsx"), 'import { useState } from "react";\nconst u = require("@scope/util");\n');
    // A vendored file that must be ignored.
    await mkdir(join(dir, "node_modules", "foo"), { recursive: true });
    await writeFile(join(dir, "node_modules", "foo", "index.js"), 'import "react";\n');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("counts files importing each package and ignores vendor dirs + subpaths/scopes", async () => {
    const counts = await scanUsageCounts(dir, ["react", "lodash", "@scope/util", "express"], {
      ecosystem: "npm",
    });
    expect(counts.get("react")).toBe(2); // a.ts + b.tsx, NOT node_modules
    expect(counts.get("lodash")).toBe(1); // "lodash/merge" → lodash
    expect(counts.get("@scope/util")).toBe(1); // scoped + require()
    expect(counts.has("express")).toBe(false); // not imported → falls back to proxy
  });
});

describe("NpmRegistryResolver", () => {
  function fakeFetch(routes: Record<string, { json?: unknown; text?: string }>, counter?: { n: number }) {
    return (async (input: unknown) => {
      if (counter !== undefined) counter.n += 1;
      const url = String(input);
      const hit = Object.entries(routes).find(([k]) => url.includes(k))?.[1];
      if (hit === undefined) return new Response("", { status: 404 });
      if (hit.text !== undefined) return new Response(hit.text, { status: 200 });
      return new Response(JSON.stringify(hit.json ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }

  it("resolves package → GitHub owner → registered wallet, with FUNDING.yml override", async () => {
    const registry = new InMemoryPayeeRegistry();
    await registry.register({ kind: "handle", externalId: "octocat", wallet: "0xowner" });
    const resolver = new NpmRegistryResolver({
      registry,
      escrowWallet: SEED_ESCROW_WALLET,
      fetchImpl: fakeFetch({
        "registry.npmjs.org/cool-lib": {
          json: { repository: { url: "git+https://github.com/OctoCat/cool-lib.git" } },
        },
        "FUNDING.yml": { text: "github: octocat\n" },
      }),
    });
    const r = await resolver.resolve("cool-lib");
    expect(r.handle).toBe("octocat");
    expect(r.wallet).toBe("0xowner");
    expect(r.claimed).toBe(true);
    expect(r.fundingUrl).toBe("https://github.com/sponsors/octocat");
  });

  it("earmarks an unregistered maintainer to escrow but keeps the handle", async () => {
    const resolver = new NpmRegistryResolver({
      registry: new InMemoryPayeeRegistry(),
      escrowWallet: SEED_ESCROW_WALLET,
      readFunding: false,
      fetchImpl: fakeFetch({
        "registry.npmjs.org/lonely": { json: { repository: "github:someone/lonely" } },
      }),
    });
    const r = await resolver.resolve("lonely");
    expect(r.handle).toBe("someone");
    expect(r.wallet).toBe(SEED_ESCROW_WALLET);
    expect(r.claimed).toBe(false);
  });

  it("degrades to escrow (no handle) on network failure, and caches", async () => {
    const counter = { n: 0 };
    const resolver = new NpmRegistryResolver({
      registry: new InMemoryPayeeRegistry(),
      escrowWallet: SEED_ESCROW_WALLET,
      fetchImpl: fakeFetch({}, counter), // every route 404s
    });
    const first = await resolver.resolve("ghost");
    const second = await resolver.resolve("ghost");
    expect(first.handle).toBeUndefined();
    expect(first.wallet).toBe(SEED_ESCROW_WALLET);
    expect(first.claimed).toBe(false);
    expect(second).toEqual(first);
    expect(counter.n).toBe(1); // second call served from cache
  });
});
