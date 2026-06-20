/**
 * `lepton deploy` — deploy the three Lepton on-chain settlement contracts.
 *
 * Shells out to Foundry's `forge script script/DeployLepton.s.sol` from the
 * contracts directory, reading the RPC URL and deployer key from flags or env,
 * then parses the three returned addresses (distributor / stream / bond) out of
 * forge's output.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { buildContext } from "../context.js";

/** Resolved options for a deploy invocation. */
export interface DeployOptions {
  rpcUrl?: string;
  privateKey?: string;
  broadcast: boolean;
  arcUsdcAddress?: string;
  forgeDir: string;
}

/** The three contract addresses returned by DeployLepton.s.sol::run(). */
export interface DeployedAddresses {
  distributor: string;
  stream: string;
  bond: string;
}

/** The forge script path, relative to the contracts (forge) directory. */
export const DEPLOY_SCRIPT_PATH = "script/DeployLepton.s.sol";

/**
 * Build the argv passed to `forge`. Pure so it can be unit-tested without
 * spawning a process. Only appends `--rpc-url` / `--private-key` when present,
 * and `--broadcast` only when requested (otherwise forge does a dry-run).
 */
export function buildForgeArgs(opts: DeployOptions): string[] {
  const args = ["script", DEPLOY_SCRIPT_PATH];
  if (opts.rpcUrl !== undefined && opts.rpcUrl !== "") {
    args.push("--rpc-url", opts.rpcUrl);
  }
  if (opts.privateKey !== undefined && opts.privateKey !== "") {
    args.push("--private-key", opts.privateKey);
  }
  if (opts.broadcast) {
    args.push("--broadcast");
  }
  return args;
}

/**
 * Parse the three named return values out of forge's stdout. forge prints the
 * `run()` return tuple as lines like:
 *
 *   0: address distributor 0xabc...
 *   1: address stream 0xdef...
 *   2: address bond 0x123...
 *
 * We match by the trailing 0x-address keyed on the return name, falling back to
 * positional 0x addresses when names are absent. Returns undefined when fewer
 * than three addresses are found.
 */
export function parseDeployedAddresses(
  stdout: string,
): DeployedAddresses | undefined {
  const byName: Partial<Record<keyof DeployedAddresses, string>> = {};
  const addressRe = /0x[a-fA-F0-9]{40}/;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    const addrMatch = line.match(addressRe);
    if (addrMatch === null) continue;
    const address = addrMatch[0];
    if (/\bdistributor\b/i.test(line)) byName.distributor = address;
    else if (/\bstream\b/i.test(line)) byName.stream = address;
    else if (/\bbond\b/i.test(line)) byName.bond = address;
  }

  if (
    byName.distributor !== undefined &&
    byName.stream !== undefined &&
    byName.bond !== undefined
  ) {
    return {
      distributor: byName.distributor,
      stream: byName.stream,
      bond: byName.bond,
    };
  }

  // Fallback: take the first three distinct 0x addresses in order.
  const positional: string[] = [];
  const globalRe = /0x[a-fA-F0-9]{40}/g;
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(stdout)) !== null) {
    if (!positional.includes(m[0])) positional.push(m[0]);
    if (positional.length === 3) break;
  }
  if (positional.length === 3) {
    return {
      distributor: positional[0] as string,
      stream: positional[1] as string,
      bond: positional[2] as string,
    };
  }
  return undefined;
}

export function registerDeploy(program: Command): void {
  program
    .command("deploy")
    .description("Deploy the Lepton contracts via forge (script/DeployLepton.s.sol)")
    .option("--rpc-url <url>", "Arc RPC URL (env ARC_RPC_URL)", process.env.ARC_RPC_URL)
    .option("--private-key <key>", "Deployer private key (env DEPLOYER_KEY)", process.env.DEPLOYER_KEY)
    .option("--broadcast", "Broadcast the transactions (default is a dry-run)", false)
    .option(
      "--arc-usdc-address <addr>",
      "USDC address injected as ARC_USDC_ADDRESS (env ARC_USDC_ADDRESS)",
      process.env.ARC_USDC_ADDRESS,
    )
    .option(
      "--forge-dir <path>",
      "Contracts (forge) directory containing foundry.toml",
      "contracts",
    )
    .action(async function (this: Command) {
      const flags = this.opts<{
        rpcUrl?: string;
        privateKey?: string;
        broadcast?: boolean;
        arcUsdcAddress?: string;
        forgeDir: string;
      }>();
      const ctx = buildContext(this);

      const forgeDir = resolve(process.cwd(), flags.forgeDir);
      if (!existsSync(forgeDir)) {
        throw new Error(`Contracts directory not found: ${forgeDir}`);
      }
      if (!existsSync(resolve(forgeDir, "foundry.toml"))) {
        throw new Error(
          `No foundry.toml in ${forgeDir}. Point --forge-dir at the contracts directory.`,
        );
      }

      const opts: DeployOptions = {
        rpcUrl: flags.rpcUrl,
        privateKey: flags.privateKey,
        broadcast: flags.broadcast === true,
        arcUsdcAddress: flags.arcUsdcAddress,
        forgeDir,
      };

      if (opts.broadcast) {
        if (opts.rpcUrl === undefined || opts.rpcUrl === "") {
          throw new Error("--broadcast requires --rpc-url (or ARC_RPC_URL).");
        }
        if (opts.privateKey === undefined || opts.privateKey === "") {
          throw new Error("--broadcast requires --private-key (or DEPLOYER_KEY).");
        }
      }

      const childEnv: NodeJS.ProcessEnv = { ...process.env };
      if (opts.arcUsdcAddress !== undefined && opts.arcUsdcAddress !== "") {
        childEnv.ARC_USDC_ADDRESS = opts.arcUsdcAddress;
      }

      const result = spawnSync("forge", buildForgeArgs(opts), {
        cwd: forgeDir,
        env: childEnv,
        encoding: "utf8",
      });

      if (result.error !== undefined) {
        const reason =
          (result.error as NodeJS.ErrnoException).code === "ENOENT"
            ? "forge not found on PATH. Install Foundry: https://book.getfoundry.sh/getting-started/installation"
            : result.error.message;
        throw new Error(reason);
      }

      const stdout = result.stdout ?? "";
      if (result.status !== 0) {
        const stderr = (result.stderr ?? "").trim() || stdout.trim();
        throw new Error(stderr || `forge exited with code ${result.status ?? "unknown"}`);
      }

      const addresses = parseDeployedAddresses(stdout);
      if (addresses === undefined) {
        throw new Error(
          "Could not parse deployed addresses from forge output. Re-run with the raw forge command to inspect.",
        );
      }

      ctx.printRecord({
        distributor: addresses.distributor,
        stream: addresses.stream,
        bond: addresses.bond,
        broadcast: opts.broadcast,
      });
    });
}
