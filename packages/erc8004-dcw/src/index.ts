/**
 * @settlekit/erc8004-dcw — a Circle Developer-Controlled-Wallet (DCW) adapter
 * that implements `@settlekit/erc8004`'s `Erc8004Port` via Circle W3S contract
 * execution. Writes go through `createContractExecution` + `pollTransaction`;
 * reads delegate to an injected chain reader. No viem / crypto dependency.
 */

export { createDcwErc8004Port, DCW_ABI_SIGNATURES } from "./dcw-port.js";
export type { DcwErc8004Config, DcwBlockchain, DcwPollOptions } from "./config.js";
export { DEFAULT_DCW_BLOCKCHAIN } from "./config.js";
export type { Erc8004Reader } from "./reader.js";
export { feedbackHash, requestHash, utf8ToHex } from "./hashing.js";
export type { Keccak256, ToHex } from "./hashing.js";
