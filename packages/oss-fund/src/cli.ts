/**
 * Runnable demo / real CLI.
 *
 *   node dist/cli.js                       # the seeded acme-web tree, $5 budget
 *   node dist/cli.js ./package.json        # your real manifest
 *   node dist/cli.js ./package.json ./package-lock.json
 *   node dist/cli.js ./requirements.txt
 *
 * Uses Claude (claude-opus-4-8) as the allocation brain when ANTHROPIC_API_KEY is
 * set, otherwise the deterministic heuristic engine. Env: BUDGET, FROM.
 *
 * For a real manifest it resolves maintainers live (npm registry + GitHub
 * FUNDING.yml) and scans your source tree for real per-package usage counts. Set
 * OSS_FUND_OFFLINE=1 to skip the network and route every maintainer to escrow.
 * It then builds the graph, scores every package, allocates the budget, and
 * settles the split over a local ledger — a reconciled report, every unit traced.
 */

import { dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { createLocalSettlement } from "@settlekit/x402-client";
import { defaultAllocationEngine } from "./claude-allocator.js";
import { buildGraph } from "./graph.js";
import { parsePackageJson, parsePackageLock, parseRequirementsTxt, type ParsedLockfile } from "./manifest.js";
import { NpmRegistryResolver } from "./npm-resolver.js";
import { planFunding } from "./plan.js";
import { RegistryMaintainerResolver, type MaintainerResolver } from "./resolver.js";
import { seedLockJson, seedManifestJson, seedMaintainers, seedRegistry, SEED_ESCROW_WALLET } from "./seed.js";
import { settleFundingPlan } from "./settle.js";
import { scanUsageCounts } from "./usage-scan.js";
import type { DependencyGraph, FundingPlan, FundingReceipt } from "./types.js";

interface LoadedProject {
  graph: DependencyGraph;
  resolver: MaintainerResolver;
  usageCounts?: Map<string, number>;
}

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

async function loadProject(): Promise<LoadedProject> {
  const manifestPath = process.argv[2];
  const lockPath = process.argv[3];

  if (manifestPath === undefined) {
    // The seeded acme-web tree — runs anywhere, offline, deterministic.
    const manifest = parsePackageJson(seedManifestJson());
    const lockfile = parsePackageLock(seedLockJson());
    const registry = await seedRegistry();
    const resolver = new RegistryMaintainerResolver(registry, {
      escrowWallet: SEED_ESCROW_WALLET,
      maintainers: seedMaintainers(),
    });
    return { graph: buildGraph(manifest, lockfile), resolver };
  }

  const content = await readFile(manifestPath, "utf8");
  const manifest = manifestPath.endsWith(".txt")
    ? parseRequirementsTxt(content)
    : parsePackageJson(content);
  let lockfile: ParsedLockfile | undefined;
  if (lockPath !== undefined) {
    lockfile = parsePackageLock(await readFile(lockPath, "utf8"));
  }
  const graph = buildGraph(manifest, lockfile);

  // Real per-package usage from your source tree (alongside the manifest).
  const projectDir = dirname(manifestPath) || ".";
  const usageCounts = await scanUsageCounts(
    projectDir,
    graph.nodes.map((n) => n.name),
    { ecosystem: manifest.ecosystem },
  );

  // The registry holds maintainers who have registered a wallet; everyone else
  // is earmarked to escrow. npm packages resolve live (registry + FUNDING.yml)
  // unless OSS_FUND_OFFLINE is set; pypi has no live resolver yet.
  const registry = await seedRegistry();
  const offline = process.env["OSS_FUND_OFFLINE"] === "1";
  const resolver: MaintainerResolver =
    manifest.ecosystem === "npm" && !offline
      ? new NpmRegistryResolver({ registry, escrowWallet: SEED_ESCROW_WALLET })
      : new RegistryMaintainerResolver(registry, {
          escrowWallet: SEED_ESCROW_WALLET,
          maintainers: new Map(),
        });

  return { graph, resolver, usageCounts };
}

function render(plan: FundingPlan, receipt: FundingReceipt, engine: string): void {
  out("");
  out("  ╔════════════════════════════════════════════════════╗");
  out("  ║   SettleKit OSS Fund — maintainer distribution     ║");
  out("  ╚════════════════════════════════════════════════════╝");
  out("");
  out(`  allocation engine : ${engine}`);
  out(`  ecosystem         : ${plan.ecosystem}`);
  out(`  monthly budget    : ${plan.budget.amount} ${plan.budget.currency}`);
  out(`  packages funded   : ${plan.allocations.filter((a) => a.amount.amount !== "0").length}/${plan.allocations.length}`);
  out(`  payout legs       : ${plan.legs.length}`);
  out(`  → escrow (unclaimed maintainers): ${plan.unclaimed.amount} USDC`);
  out("");
  out("  per-package allocation (top by share):");
  const top = [...plan.allocations].sort((a, b) => b.weight - a.weight).slice(0, 14);
  for (const a of top) {
    const s = a.signals;
    const tag = a.claimed ? "       " : "ESCROW ";
    out(
      `    ${a.name.padEnd(16)} ${a.amount.amount.padStart(10)} USDC  ${tag}` +
        `[direct ${s.directness.toFixed(2)}  reach ${String(s.reach).padStart(2)}  use ${String(s.usage).padStart(2)}  underfunded ${s.underfunding.toFixed(2)}]`,
    );
  }
  out("");
  out("  settlement legs (per maintainer wallet):");
  for (const leg of receipt.settlements) {
    out(`    ${leg.wallet}  ${leg.amount.amount.padStart(10)} USDC  ${leg.txHash.slice(0, 14)}…  (${leg.packages.length} pkgs)`);
  }
  out("");
  out(`  distributed       : ${receipt.distributed.amount} USDC`);
  out(`  reconciled        : ${receipt.reconciled ? "yes — every base unit accounted for" : "NO — mismatch"}`);
  out("");
}

async function main(): Promise<void> {
  const { graph, resolver, usageCounts } = await loadProject();
  const engine = defaultAllocationEngine();
  const budget = env("BUDGET", "5");

  const plan = await planFunding({
    graph,
    budgetUsdc: budget,
    resolver,
    engine,
    ...(usageCounts !== undefined ? { usageCounts } : {}),
  });

  const { settler } = createLocalSettlement();
  const receipt = await settleFundingPlan(plan, { settler, from: env("FROM", "0xfunder") });

  render(plan, receipt, engine.name);
  if (!receipt.reconciled) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`oss-fund failed: ${message}\n`);
  process.exitCode = 1;
});
