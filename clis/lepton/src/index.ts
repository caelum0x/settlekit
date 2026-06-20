#!/usr/bin/env node
/**
 * `lepton` — the Lepton stack operator CLI.
 *
 * Wires every command group onto a single commander program with a global
 * `--json` flag and a top-level error handler that prints a clean message and
 * exits non-zero on failure.
 *
 * Usage:
 *   lepton deploy --rpc-url ... --private-key ... --broadcast
 *   lepton config --org-id org_1 --escrow-wallet 0x... --out .env.lepton
 *   lepton settlements list --status settled
 *   lepton lineage shares --root b --edge b:a:0.5
 *   lepton proof issue --agent a --source-id s1 --access-id acc --secret X
 */
import { Command } from "commander";
import { formatError } from "./output.js";
import { registerDeploy } from "./commands/deploy.js";
import { registerConfig } from "./commands/config.js";
import { registerSettlements } from "./commands/settlements.js";
import { registerLineage } from "./commands/lineage.js";
import { registerProof } from "./commands/proof.js";

function buildProgram(): Command {
  const program = new Command();
  program
    .name("lepton")
    .description("Lepton operator CLI — deploy contracts, generate config, inspect settlements, walk lineage, and issue/verify citation proofs.")
    .version("0.0.0")
    .option("--json", "Print raw JSON instead of formatted tables", false);

  registerDeploy(program);
  registerConfig(program);
  registerSettlements(program);
  registerLineage(program);
  registerProof(program);

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    process.stderr.write(`${formatError(err)}\n`);
    process.exitCode = 1;
  }
}

void main();
