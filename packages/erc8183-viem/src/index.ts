/**
 * @settlekit/erc8183-viem — a live, ABI-injectable viem adapter implementing
 * `@settlekit/erc8183`'s `Erc8183Port` against the deployed ERC-8183 job
 * contract on Arc.
 *
 * The DEFAULT_ERC8183_ABI is ASSUMED from the documented lifecycle — confirm it
 * against the deployed contract and override via `config.abi` if needed.
 */

export { createViemErc8183Port } from "./port.js";
export { configureViemErc8183 } from "./configure.js";
export { DEFAULT_ERC8183_ABI, JOB_STATUS_BY_INDEX } from "./abi.js";
export { defineArcChain, type DefineArcChainInput } from "./chain.js";
export {
  toUsdcBaseUnits,
  fromUsdcBaseUnits,
  parseUsdc,
  formatUsdc,
  jobAmountToMoney,
} from "./amount.js";
export {
  resolveAccount,
  readPrivateKeyFromEnv,
  isPrivateKey,
  type ResolveAccountInput,
} from "./account.js";
export { resolvePublicClient, resolveWalletClient } from "./clients.js";

export type { ViemErc8183Config, Hex } from "./types.js";

// Re-export the implemented interface for consumer convenience.
export type { Erc8183Port } from "@settlekit/erc8183";
