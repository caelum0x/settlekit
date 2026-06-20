/**
 * @settlekit/erc8183-dcw — a Circle Developer-Controlled-Wallet (DCW) adapter
 * implementing `@settlekit/erc8183`'s `Erc8183Port` against the **real**
 * AgenticCommerce ERC-8183 reference contract on Arc Testnet, via
 * `@settlekit/circle-wallets` `createContractExecution` + `pollTransaction`.
 *
 * NO viem / chain SDK dependency — DCW posts `abiFunctionSignature` strings +
 * string `abiParameters`. Reads (`getJob`), `jobId` recovery (JobCreated event),
 * and `bytes32` hashing are INJECTED callbacks (see {@link DcwErc8183Config}) and
 * are never silently faked. `refund` throws by design (no on-chain function).
 */

export { createDcwErc8183Port } from "./port.js";
export { configureDcwErc8183 } from "./configure.js";

export {
  AGENTIC_COMMERCE_ADDRESS,
  USDC_ADDRESS,
  DEFAULT_BLOCKCHAIN,
  ZERO_ADDRESS,
  EMPTY_BYTES,
  ABI_SIGNATURES,
  JOB_STATUS_BY_INDEX,
  jobStatusFromIndex,
  type OnChainStatusLabel,
} from "./contract.js";

export { toUsdcBaseUnitsString, jobAmountToMoney } from "./amount.js";

export type {
  DcwErc8183Config,
  DcwWalletsClient,
  DcwPollOptions,
  CompletedTransaction,
  DecodedJobCreated,
  OnChainJobTuple,
} from "./types.js";

// Re-export the implemented interface for consumer convenience.
export type { Erc8183Port } from "@settlekit/erc8183";
