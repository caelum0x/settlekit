/**
 * @settlekit/erc8004-viem — a live viem adapter implementing
 * `@settlekit/erc8004`'s {@link Erc8004Port} against the deployed ERC-8004
 * registries on Arc.
 *
 * `createViemErc8004Port(config)` is the entry point. The pure, transport-free
 * pieces (ABIs, hashing, chain builder, config defaulting, account derivation)
 * are exported too so they can be unit-tested without a network.
 */

export { createViemErc8004Port } from "./port.js";

export type {
  ViemErc8004Config,
  ResolvedViemErc8004Config,
} from "./config.js";
export { resolveConfig } from "./config.js";

export {
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ABI,
  VALIDATION_REGISTRY_ABI,
} from "./abis.js";

export { feedbackHash, requestHash, ZERO_BYTES32 } from "./hashing.js";
export type { Bytes32 } from "./hashing.js";

export {
  arcTestnetChain,
  defineArcChain,
  ARC_TESTNET_CHAIN_ID,
} from "./viem-chain.js";
export type { DefineArcChainOptions } from "./viem-chain.js";

export {
  deriveAccount,
  resolveClients,
  requireWallet,
} from "./clients.js";
export type { ResolvedClients } from "./clients.js";

/** Convenience re-export of the implemented port interface. */
export type { Erc8004Port } from "@settlekit/erc8004";
