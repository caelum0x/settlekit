/** Classification of every {@link PaymentNetwork} by chain family. */

import type { PaymentNetwork } from "@settlekit/common";
import { isEvmChainKey, type EvmChainKey } from "./registry.js";

/**
 * `hypercore` is Hyperliquid's L1 (HyperCore): EVM-style addresses and
 * 0x-prefixed 32-byte hashes, but no EVM receipts — verified through the
 * Hyperliquid info API (@settlekit/hyperliquid), not an EVM RPC.
 */
export type NetworkFamily = "evm" | "solana" | "zcash" | "hypercore";

/** The chain family `network` belongs to. */
export function networkFamily(network: PaymentNetwork): NetworkFamily {
  if (network === "solana") return "solana";
  if (network === "zcash") return "zcash";
  if (network === "hypercore") return "hypercore";
  return "evm";
}

/** Narrow a payment network to an EVM chain key. */
export function isEvmNetwork(network: PaymentNetwork): network is PaymentNetwork & EvmChainKey {
  return isEvmChainKey(network);
}
