/**
 * Solana cluster definitions: public RPC endpoints, CAIP-2 chain ids, and the
 * canonical Circle USDC mint per cluster.
 *
 * Sources: Circle "USDC contract addresses" (Solana mainnet/devnet mints) and
 * the CAIP-2 Solana namespace (genesis-hash-prefix chain references).
 */

/** Clusters SettleKit settles on. */
export type SolanaCluster = "mainnet" | "devnet";

/** Commitment levels usable when reading confirmed transactions. */
export type SolanaFinality = "confirmed" | "finalized";

/** USDC exposes 6 decimals on every Solana cluster. */
export const SOLANA_USDC_DECIMALS = 6;

/** The Circle USDC mint on Solana mainnet-beta. */
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** The Circle USDC mint on Solana devnet. */
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

/** A fully described Solana cluster. */
export interface SolanaClusterInfo {
  cluster: SolanaCluster;
  /** CAIP-2 chain id (`solana:<genesis-hash-prefix>`). */
  caip2: string;
  /** Public RPC endpoint; rate limited — override with a dedicated RPC in prod. */
  rpcUrl: string;
  /** Circle USDC mint address. */
  usdcMint: string;
  /** Solscan `?cluster=` suffix (empty for mainnet). */
  explorerClusterParam: string;
}

export const SOLANA_MAINNET: SolanaClusterInfo = {
  cluster: "mainnet",
  caip2: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  rpcUrl: "https://api.mainnet-beta.solana.com",
  usdcMint: USDC_MINT_MAINNET,
  explorerClusterParam: "",
};

export const SOLANA_DEVNET: SolanaClusterInfo = {
  cluster: "devnet",
  caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  rpcUrl: "https://api.devnet.solana.com",
  usdcMint: USDC_MINT_DEVNET,
  explorerClusterParam: "?cluster=devnet",
};

export const SOLANA_CLUSTERS: Readonly<Record<SolanaCluster, SolanaClusterInfo>> = {
  mainnet: SOLANA_MAINNET,
  devnet: SOLANA_DEVNET,
};

/**
 * Parse a cluster name. Accepts the canonical names plus the common
 * `mainnet-beta` alias; returns `undefined` for anything else.
 */
export function parseSolanaCluster(value: string): SolanaCluster | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "mainnet" || normalized === "mainnet-beta") return "mainnet";
  if (normalized === "devnet") return "devnet";
  return undefined;
}

/** Look up a cluster definition. */
export function getSolanaCluster(cluster: SolanaCluster): SolanaClusterInfo {
  return SOLANA_CLUSTERS[cluster];
}

/** Solscan link for a transaction signature on a cluster. */
export function solscanTxUrl(signature: string, cluster: SolanaCluster): string {
  return `https://solscan.io/tx/${signature}${SOLANA_CLUSTERS[cluster].explorerClusterParam}`;
}
