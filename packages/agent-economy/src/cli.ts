/**
 * Runnable demo: spin up the Lepton agent economy and print a reconciled
 * report. Uses Claude as the decision engine when ANTHROPIC_API_KEY is set,
 * otherwise the deterministic heuristic engine.
 *
 *   node dist/cli.js          # or: pnpm --filter @settlekit/agent-economy demo
 *
 * Env: AGENTS, BUDGET, MAX_PRICE, MAX_PURCHASES.
 */

import { defaultDecisionEngine } from "@settlekit/agent";
import { type EconomyReport, runAgentEconomy } from "./economy.js";
import { seedLeptonSources } from "./seed.js";

function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value !== undefined && value.length > 0 ? value : fallback;
}

function out(line = ""): void {
  process.stdout.write(`${line}\n`);
}

function render(report: EconomyReport, engine: string): void {
  out("");
  out("  ╔══════════════════════════════════════════════╗");
  out("  ║   Lepton Agent Economy — settlement report   ║");
  out("  ╚══════════════════════════════════════════════╝");
  out("");
  out(`  decision engine : ${engine}`);
  out(`  agents          : ${report.agents}`);
  out(`  payments settled: ${report.totalPayments}`);
  out(`  volume          : ${report.totalVolumeUsdc} USDC`);
  out(`  platform fees   : ${report.platformFeesUsdc} USDC`);
  out("");
  out("  author earnings (recursive royalty splits):");
  for (const e of report.authorEarnings) {
    out(`    ${e.wallet}  ${e.amountUsdc.padStart(10)} USDC`);
  }
  out("");
  out("  per-agent spend:");
  for (const a of report.perAgent) {
    out(`    ${a.from}  ${a.spentUsdc.padStart(10)} USDC  (${a.purchases} calls)`);
  }
  out("");
}

async function main(): Promise<void> {
  const useClaude = Boolean(process.env["ANTHROPIC_API_KEY"]);
  const report = await runAgentEconomy({
    sources: seedLeptonSources(),
    agentCount: Number(env("AGENTS", "5")),
    perAgentBudgetUsdc: env("BUDGET", "0.005"),
    maxPriceUsdc: env("MAX_PRICE", "0.001"),
    maxPurchasesPerAgent: Number(env("MAX_PURCHASES", "3")),
    ...(useClaude ? { makeEngine: () => defaultDecisionEngine() } : {}),
  });
  render(report, useClaude ? "claude (claude-opus-4-8)" : "heuristic");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`agent-economy failed: ${message}\n`);
  process.exitCode = 1;
});
