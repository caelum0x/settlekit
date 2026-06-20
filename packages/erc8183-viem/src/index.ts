/**
 * @settlekit/erc8183-viem — a live viem adapter implementing
 * `@settlekit/erc8183`'s `Erc8183Port` against the REAL deployed AgenticCommerce
 * (ERC-8183) job contract on Arc.
 *
 * The default ABI ({@link AGENTIC_COMMERCE_ABI}) and the default contract/USDC
 * addresses match the deployed reference implementation; all are overridable via
 * `config`.
 */

export { createViemErc8183Port } from "./port.js";
export { configureViemErc8183 } from "./configure.js";
export {
  AGENTIC_COMMERCE_ABI,
  DEFAULT_ERC8183_ABI,
  USDC_ABI,
  ERC20_APPROVE_ABI,
  DEFAULT_AGENTIC_COMMERCE_ADDRESS,
  DEFAULT_USDC_ADDRESS,
  JOB_STATUS_BY_INDEX,
} from "./abi.js";
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
