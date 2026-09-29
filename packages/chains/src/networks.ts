/** Classification of every {@link PaymentNetwork} by chain family. */

import type { PaymentNetwork } from "@settlekit/common";
import { isEvmChainKey, type EvmChainKey } from "./registry.js";

export type NetworkFamily = "evm" | "solana" | "zcash";

/** The chain family `network` belongs to. */
export function networkFamily(network: PaymentNetwork): NetworkFamily {
  if (network === "solana") return "solana";
  if (network === "zcash") return "zcash";
  return "evm";
}

/** Narrow a payment network to an EVM chain key. */
export function isEvmNetwork(network: PaymentNetwork): network is PaymentNetwork & EvmChainKey {
  return isEvmChainKey(network);
}
