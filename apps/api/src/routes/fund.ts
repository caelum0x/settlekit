/**
 * Open-source maintainer funding routes (PUBLIC — no API key).
 *
 * The thesis made clickable: turn a dependency manifest into a conserved,
 * signal-weighted distribution of a small monthly budget across maintainer
 * wallets, settled over the in-memory nanopayment ledger so it runs anywhere.
 *
 *   GET  /v1/fund                 overview
 *   GET  /v1/fund/demo            allocate + settle the seeded acme-web tree
 *   POST /v1/fund/plan            allocate + settle YOUR package.json/requirements.txt
 *
 * Module: @settlekit/oss-fund (manifest → dependency graph → maintainer wallets →
 * allocation engine → recursive split settlement).
 */
import { Hono } from "hono";
import {
  ClaudeAllocationEngine,
  HeuristicAllocationEngine,
  RegistryMaintainerResolver,
  SEED_ESCROW_WALLET,
  buildGraph,
  parsePackageJson,
  parsePackageLock,
  parseRequirementsTxt,
  planFunding,
  seedLockJson,
  seedMaintainers,
  seedManifestJson,
  seedRegistry,
  settleFundingPlan,
  toDistributorCall,
  type AllocationEngine,
  type FundingPlan,
} from "@settlekit/oss-fund";
import { createLocalSettlement } from "@settlekit/x402-client";
import type { AppEnv } from "../context.js";

/**
 * Accept only a well-formed non-negative decimal amount, truncated to USDC's 6
 * decimal places (so an over-precise budget can't reach `money()` and 500). */
function safeAmount(value: string | undefined, fallback: string): string {
  if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return fallback;
  const [whole, frac] = value.split(".");
  return frac !== undefined && frac.length > 6 ? `${whole}.${frac.slice(0, 6)}` : value;
}

/** Pick the allocation engine. Claude is opt-in and requires a configured key. */
function pickEngine(wantsClaude: boolean): { engine: AllocationEngine; note?: string } {
  const claudeReady = wantsClaude && Boolean(process.env["ANTHROPIC_API_KEY"]);
  if (wantsClaude && !claudeReady) {
    return {
      engine: new HeuristicAllocationEngine(),
      note: "ANTHROPIC_API_KEY not configured on this deployment; ran the heuristic engine.",
    };
  }
  return { engine: claudeReady ? new ClaudeAllocationEngine() : new HeuristicAllocationEngine() };
}

/** Settle a plan on a fresh local ledger and shape the JSON response. */
async function settleAndShape(plan: FundingPlan, note?: string): Promise<Record<string, unknown>> {
  const { settler } = createLocalSettlement();
  const receipt = await settleFundingPlan(plan, { settler, from: "0xfunder" });
  // An empty plan (a manifest with no resolvable dependencies) can't distribute
  // the budget — say so plainly rather than reporting a bare reconciled:false.
  const effectiveNote =
    receipt.settlements.length === 0
      ? [note, "No fundable dependencies were found in the manifest."].filter(Boolean).join(" ")
      : note;
  return {
    engine: plan.engine,
    ...(effectiveNote !== undefined && effectiveNote.length > 0 ? { note: effectiveNote } : {}),
    budget: plan.budget.amount,
    unclaimedEscrow: plan.unclaimed.amount,
    allocations: plan.allocations
      .filter((a) => a.amount.amount !== "0")
      .map((a) => ({
        name: a.name,
        amount: a.amount.amount,
        claimed: a.claimed,
        ...(a.handle !== undefined ? { handle: a.handle } : {}),
        weight: Number(a.weight.toFixed(6)),
        signals: a.signals,
      })),
    legs: receipt.settlements.map((s) => ({
      wallet: s.wallet,
      amount: s.amount.amount,
      txHash: s.txHash,
      packages: s.packages,
    })),
    distributed: receipt.distributed.amount,
    reconciled: receipt.reconciled,
    onchain: toDistributorCall(plan),
  };
}

export function fundRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) =>
    c.json({
      data: {
        name: "SettleKit OSS Fund — fund the maintainers your tree leans on",
        how: "Manifest → dependency graph → maintainer wallets → signal-weighted, conserved allocation → recursive-split settlement.",
        signals: ["directness", "reach (criticality)", "usage", "underfunding"],
        endpoints: {
          demo: "/v1/fund/demo?budget=5&engine=heuristic",
          plan: "POST /v1/fund/plan { manifest, lockfile?, ecosystem?, budget }",
        },
      },
    }),
  );

  // Allocate + settle the seeded acme-web dependency tree.
  app.get("/demo", async (c) => {
    const budget = safeAmount(c.req.query("budget"), "5");
    const { engine, note } = pickEngine(c.req.query("engine") === "claude");

    const manifest = parsePackageJson(seedManifestJson());
    const lockfile = parsePackageLock(seedLockJson());
    const registry = await seedRegistry();
    const resolver = new RegistryMaintainerResolver(registry, {
      escrowWallet: SEED_ESCROW_WALLET,
      maintainers: seedMaintainers(),
    });

    try {
      const plan = await planFunding({
        graph: buildGraph(manifest, lockfile),
        budgetUsdc: budget,
        resolver,
        engine,
      });
      return c.json({ data: await settleAndShape(plan, note) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "allocation failed";
      return c.json({ error: { code: "internal_error", message } }, 500);
    }
  });

  // Allocate + settle a caller-supplied manifest. Known packages resolve to the
  // seeded maintainer wallets; unknown maintainers are earmarked to escrow.
  app.post("/plan", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      manifest?: unknown;
      lockfile?: unknown;
      ecosystem?: unknown;
      budget?: unknown;
    };
    if (typeof body.manifest !== "string" || body.manifest.length === 0) {
      return c.json({ error: { code: "validation_error", message: "manifest (string) is required" } }, 400);
    }
    const budget = safeAmount(typeof body.budget === "string" ? body.budget : undefined, "5");
    const { engine, note } = pickEngine(c.req.query("engine") === "claude");

    let manifest;
    let lockfile;
    try {
      manifest =
        body.ecosystem === "pypi"
          ? parseRequirementsTxt(body.manifest)
          : parsePackageJson(body.manifest);
      lockfile =
        typeof body.lockfile === "string" && body.lockfile.length > 0
          ? parsePackageLock(body.lockfile)
          : undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not parse manifest/lockfile";
      return c.json({ error: { code: "validation_error", message } }, 400);
    }

    const registry = await seedRegistry();
    const resolver = new RegistryMaintainerResolver(registry, {
      escrowWallet: SEED_ESCROW_WALLET,
      maintainers: seedMaintainers(),
    });

    try {
      const plan = await planFunding({
        graph: buildGraph(manifest, lockfile),
        budgetUsdc: budget,
        resolver,
        engine,
      });
      return c.json({ data: await settleAndShape(plan, note) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "allocation failed";
      return c.json({ error: { code: "internal_error", message } }, 500);
    }
  });

  return app;
}
