/**
 * CAIP-2 chain ids per payment network.
 *
 * EVM chains use `eip155:<chainId>`; Solana uses its genesis-hash ids.
 * Zcash has no registered CAIP-2 namespace, so SettleKit uses the internal,
 * non-standard `zcash:mainnet` / `zcash:testnet`; HyperCore (Hyperliquid
 * L1, not an EVM chain) likewise uses `hlcore:mainnet` / `hlcore:testnet`
 * (CAIP-2 namespaces are 3-8 characters).
 */

import type { PaymentNetwork } from "@settlekit/common";
import { getEvmChain, type ChainEnv } from "./registry.js";
import { isEvmNetwork } from "./networks.js";

export const SOLANA_CAIP2: Readonly<Record<ChainEnv, string>> = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  testnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const ZCASH_CAIP2: Readonly<Record<ChainEnv, string>> = {
  mainnet: "zcash:mainnet",
  testnet: "zcash:testnet",
};

export const HYPERCORE_CAIP2: Readonly<Record<ChainEnv, string>> = {
  mainnet: "hlcore:mainnet",
  testnet: "hlcore:testnet",
};

/** The CAIP-2 id for `network` on `env`, or null when that pairing does not exist. */
export function caip2For(network: PaymentNetwork, env: ChainEnv): string | null {
  if (network === "solana") return SOLANA_CAIP2[env];
  if (network === "zcash") return ZCASH_CAIP2[env];
  if (network === "hypercore") return HYPERCORE_CAIP2[env];
  if (isEvmNetwork(network)) return getEvmChain(network, env)?.caip2 ?? null;
  return null;
}

/** Split a CAIP-2 id into namespace and reference. */
export function parseCaip2(value: string): { namespace: string; reference: string } | null {
  const match = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32})$/.exec(value);
  return match ? { namespace: match[1] as string, reference: match[2] as string } : null;
}
