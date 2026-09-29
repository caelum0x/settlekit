/**
 * HyperCore (Hyperliquid L1) payment configuration from the environment.
 *
 *   HYPERCORE_ENABLED   true | 1 enables HyperCore USDC payments (default off: fail closed)
 *   HYPERCORE_NETWORK   mainnet | testnet (defaults to SETTLEKIT_CHAIN_ENV, then testnet)
 *   HYPERCORE_API_URL   Hyperliquid API base URL (defaults per network)
 */

import { ChainConfigError, parseChainEnv, readEnv, type ChainEnv, type Env } from "@settlekit/chains";

export const HYPERLIQUID_MAINNET_API_URL = "https://api.hyperliquid.xyz";
export const HYPERLIQUID_TESTNET_API_URL = "https://api.hyperliquid-testnet.xyz";

export type HyperliquidChain = "Mainnet" | "Testnet";

export interface HyperCoreConfig {
  network: ChainEnv;
  /** Value signed into every user-signed action (`hyperliquidChain`). */
  hyperliquidChain: HyperliquidChain;
  apiUrl: string;
}

function enabledFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new ChainConfigError(`HYPERCORE_ENABLED must be true or false, got "${value}"`);
}

/** Default API base URL for `network`. */
export function defaultHyperliquidApiUrl(network: ChainEnv): string {
  return network === "mainnet" ? HYPERLIQUID_MAINNET_API_URL : HYPERLIQUID_TESTNET_API_URL;
}

/** HyperCore config, or null when HYPERCORE_ENABLED is unset/false (fail closed). */
export function loadHyperCoreConfig(env: Env): HyperCoreConfig | null {
  if (!enabledFlag(readEnv(env, "HYPERCORE_ENABLED"))) return null;
  const network =
    parseChainEnv(readEnv(env, "HYPERCORE_NETWORK"), "HYPERCORE_NETWORK") ??
    parseChainEnv(readEnv(env, "SETTLEKIT_CHAIN_ENV"), "SETTLEKIT_CHAIN_ENV") ??
    "testnet";
  const apiUrl = readEnv(env, "HYPERCORE_API_URL") ?? defaultHyperliquidApiUrl(network);
  if (!/^https?:\/\//.test(apiUrl)) throw new ChainConfigError("HYPERCORE_API_URL must be an http(s) URL");
  return {
    network,
    hyperliquidChain: network === "mainnet" ? "Mainnet" : "Testnet",
    apiUrl: apiUrl.replace(/\/+$/, ""),
  };
}

/** Hyperliquid explorer link for a HyperCore transaction hash. */
export function hyperCoreTxUrl(hash: string, network: ChainEnv = "mainnet"): string {
  const host = network === "mainnet" ? "app.hyperliquid.xyz" : "app.hyperliquid-testnet.xyz";
  return `https://${host}/explorer/tx/${encodeURIComponent(hash)}`;
}
