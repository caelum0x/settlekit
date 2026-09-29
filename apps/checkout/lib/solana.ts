/**
 * Solana settlement configuration for the hosted checkout.
 *
 * Read from the environment (same names as the API + worker):
 *   SOLANA_CLUSTER         mainnet | mainnet-beta | devnet   (required to enable)
 *   SOLANA_RPC_URL         RPC endpoint (defaults to the cluster's public RPC)
 *   SOLANA_USDC_MINT       USDC mint (defaults to Circle's mint for the cluster)
 *   SOLANA_MIN_COMMITMENT  confirmed | finalized (defaults to confirmed)
 *
 * FAIL CLOSED: when Solana is not configured (or misconfigured) the loader
 * returns an error value — never `null` — so no caller can mistake "no
 * verifier" for "verified". A Solana session can then never be confirmed.
 */
import {
  createKitSolanaRpc,
  getSolanaCluster,
  isSolanaAddress,
  parseSolanaCluster,
  type SolanaCluster,
  type SolanaFinality,
  type SolanaRpc,
} from "@settlekit/solana";

/** Resolved Solana settlement configuration. */
export interface SolanaCheckoutConfig {
  cluster: SolanaCluster;
  rpcUrl: string;
  usdcMint: string;
  commitment: SolanaFinality;
}

export type SolanaConfigResult =
  | { ok: true; config: SolanaCheckoutConfig }
  | { ok: false; error: string };

type Env = Readonly<Record<string, string | undefined>>;

function read(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseCommitment(raw: string | undefined): SolanaFinality | undefined {
  if (raw === undefined) return "confirmed";
  const value = raw.toLowerCase();
  return value === "confirmed" || value === "finalized" ? value : undefined;
}

/** Load Solana config from `env`; an error result when absent or invalid. */
export function loadSolanaConfig(env: Env = process.env): SolanaConfigResult {
  const clusterRaw = read(env, "SOLANA_CLUSTER");
  if (clusterRaw === undefined) {
    return { ok: false, error: "Solana payments are not configured on this checkout (SOLANA_CLUSTER is unset)." };
  }
  const cluster = parseSolanaCluster(clusterRaw);
  if (cluster === undefined) {
    return { ok: false, error: `SOLANA_CLUSTER must be mainnet or devnet, got "${clusterRaw}".` };
  }
  const known = getSolanaCluster(cluster);
  const usdcMint = read(env, "SOLANA_USDC_MINT") ?? known.usdcMint;
  if (!isSolanaAddress(usdcMint)) {
    return { ok: false, error: "SOLANA_USDC_MINT must be a base58 Solana address." };
  }
  const commitment = parseCommitment(read(env, "SOLANA_MIN_COMMITMENT"));
  if (commitment === undefined) {
    return { ok: false, error: "SOLANA_MIN_COMMITMENT must be confirmed or finalized." };
  }
  return {
    ok: true,
    config: { cluster, rpcUrl: read(env, "SOLANA_RPC_URL") ?? known.rpcUrl, usdcMint, commitment },
  };
}

/** Configured Solana runtime: config + an RPC client. */
export interface SolanaRuntime {
  config: SolanaCheckoutConfig;
  rpc: SolanaRpc;
}

export type SolanaRuntimeResult = { ok: true; runtime: SolanaRuntime } | { ok: false; error: string };

let cached: { key: string; runtime: SolanaRuntime } | undefined;

/** The process-wide Solana runtime (RPC client reused per config). */
export function getSolanaRuntime(env: Env = process.env): SolanaRuntimeResult {
  const loaded = loadSolanaConfig(env);
  if (!loaded.ok) return loaded;
  const key = JSON.stringify(loaded.config);
  if (cached?.key !== key) {
    cached = { key, runtime: { config: loaded.config, rpc: createKitSolanaRpc(loaded.config.rpcUrl) } };
  }
  return { ok: true, runtime: cached.runtime };
}

/** Cluster explorer links should point at (mainnet when Solana is unconfigured). */
export function configuredSolanaCluster(env: Env = process.env): SolanaCluster {
  const loaded = loadSolanaConfig(env);
  return loaded.ok ? loaded.config.cluster : "mainnet";
}
