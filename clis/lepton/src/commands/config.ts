/**
 * `lepton config` — generate a sidecar `.env` for a Lepton deployment.
 *
 * Resolves the seven sidecar settings from flags with safe defaults (generating
 * a fresh CITATION_PROOF_SECRET when one is not supplied) and writes them to a
 * dotenv file. Refuses to clobber an existing file unless `--force`.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Command } from "commander";
import { generateSecret } from "@settlekit/common";
import { buildContext } from "../context.js";

/** Settlement backends the sidecar can be wired to. */
export const SETTLEMENT_PROVIDERS = ["local", "circle"] as const;
export type ConfigSettlementProvider = (typeof SETTLEMENT_PROVIDERS)[number];

/** Default values applied when a flag is omitted. */
export const CONFIG_DEFAULTS = {
  port: "8788",
  orgId: "org_local",
  network: "arc",
  escrowWallet: "",
  arcIndexerUrl: "https://indexer.testnet.arc.network",
  settlementProvider: "local" as ConfigSettlementProvider,
} as const;

/** The fully-resolved set of values written to the sidecar `.env`. */
export interface ResolvedConfig {
  PORT: string;
  ORG_ID: string;
  NETWORK: string;
  ESCROW_WALLET: string;
  CITATION_PROOF_SECRET: string;
  ARC_INDEXER_URL: string;
  SETTLEMENT_PROVIDER: ConfigSettlementProvider;
}

/** Validate the settlement provider flag against the allowed literals. */
export function parseSettlementProvider(value: string): ConfigSettlementProvider {
  if ((SETTLEMENT_PROVIDERS as readonly string[]).includes(value)) {
    return value as ConfigSettlementProvider;
  }
  throw new Error(
    `Invalid --settlement-provider "${value}". Expected one of: ${SETTLEMENT_PROVIDERS.join(", ")}.`,
  );
}

/** Render a {@link ResolvedConfig} as dotenv file contents (trailing newline). */
export function renderConfigEnv(config: ResolvedConfig): string {
  const lines = [
    `PORT=${config.PORT}`,
    `ORG_ID=${config.ORG_ID}`,
    `NETWORK=${config.NETWORK}`,
    `ESCROW_WALLET=${config.ESCROW_WALLET}`,
    `CITATION_PROOF_SECRET=${config.CITATION_PROOF_SECRET}`,
    `ARC_INDEXER_URL=${config.ARC_INDEXER_URL}`,
    `SETTLEMENT_PROVIDER=${config.SETTLEMENT_PROVIDER}`,
  ];
  return `${lines.join("\n")}\n`;
}

/** Raw flag shape from commander. */
export interface ConfigFlags {
  port?: string;
  orgId?: string;
  network?: string;
  escrowWallet?: string;
  citationProofSecret?: string;
  arcIndexerUrl?: string;
  settlementProvider?: string;
}

/**
 * Resolve flags into a {@link ResolvedConfig}, applying defaults and generating
 * a citation-proof secret when one was not supplied. Pure (the only impurity is
 * the random secret, injectable via `makeSecret` for tests).
 */
export function resolveConfig(
  flags: ConfigFlags,
  makeSecret: () => string = () => generateSecret(),
): ResolvedConfig {
  return {
    PORT: flags.port ?? CONFIG_DEFAULTS.port,
    ORG_ID: flags.orgId ?? CONFIG_DEFAULTS.orgId,
    NETWORK: flags.network ?? CONFIG_DEFAULTS.network,
    ESCROW_WALLET: flags.escrowWallet ?? CONFIG_DEFAULTS.escrowWallet,
    CITATION_PROOF_SECRET:
      flags.citationProofSecret !== undefined && flags.citationProofSecret !== ""
        ? flags.citationProofSecret
        : makeSecret(),
    ARC_INDEXER_URL: flags.arcIndexerUrl ?? CONFIG_DEFAULTS.arcIndexerUrl,
    SETTLEMENT_PROVIDER:
      flags.settlementProvider !== undefined
        ? parseSettlementProvider(flags.settlementProvider)
        : CONFIG_DEFAULTS.settlementProvider,
  };
}

export function registerConfig(program: Command): void {
  program
    .command("config")
    .description("Generate a sidecar .env (port, org, network, escrow, secret, indexer, provider)")
    .option("--port <port>", "HTTP port for the sidecar", CONFIG_DEFAULTS.port)
    .option("--org-id <id>", "Organization id", CONFIG_DEFAULTS.orgId)
    .option("--network <network>", "Payment network", CONFIG_DEFAULTS.network)
    .option("--escrow-wallet <addr>", "Escrow wallet address")
    .option(
      "--citation-proof-secret <secret>",
      "HMAC secret for citation proofs (generated when omitted)",
    )
    .option("--arc-indexer-url <url>", "Arc indexer URL", CONFIG_DEFAULTS.arcIndexerUrl)
    .option(
      "--settlement-provider <provider>",
      `Settlement backend (${SETTLEMENT_PROVIDERS.join(" | ")})`,
      CONFIG_DEFAULTS.settlementProvider,
    )
    .option("--out <path>", "Output file path", ".env.lepton")
    .option("--force", "Overwrite an existing output file", false)
    .action(async function (this: Command) {
      const flags = this.opts<ConfigFlags & { out: string; force?: boolean }>();
      const ctx = buildContext(this);

      const outPath = resolve(process.cwd(), flags.out);
      if (existsSync(outPath) && flags.force !== true) {
        throw new Error(
          `Refusing to overwrite existing file: ${outPath}. Pass --force to overwrite.`,
        );
      }

      const config = resolveConfig(flags);
      writeFileSync(outPath, renderConfigEnv(config), { mode: 0o600 });

      if (ctx.json) {
        ctx.printRecord({ ...config, out: outPath });
      } else {
        ctx.printRecord({
          out: outPath,
          PORT: config.PORT,
          ORG_ID: config.ORG_ID,
          NETWORK: config.NETWORK,
          ESCROW_WALLET: config.ESCROW_WALLET || "(unset)",
          CITATION_PROOF_SECRET: "(written, hidden)",
          ARC_INDEXER_URL: config.ARC_INDEXER_URL,
          SETTLEMENT_PROVIDER: config.SETTLEMENT_PROVIDER,
        });
      }
    });
}
