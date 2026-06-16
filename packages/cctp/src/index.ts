/**
 * @settlekit/cctp — Circle CCTP V2 cross-chain USDC transfer.
 *
 * Pure encoding (burn/mint calldata + tx requests) split from I/O (the Iris
 * attestation API behind an injected transport), mirroring `@settlekit/arc` and
 * `@settlekit/circle`. Build a customer's burn tx, poll Iris for the
 * attestation, then build the mint tx to release USDC on the destination chain.
 */

export {
  CCTP_DOMAINS,
  getCctpDomain,
  getCctpChainName,
  isKnownCctpDomain,
} from "./domains.js";
export type { CctpChainName } from "./domains.js";

export { TOKEN_MESSENGER_V2_ABI, MESSAGE_TRANSMITTER_V2_ABI } from "./abi.js";

export {
  addressToBytes32,
  buildDepositForBurnTx,
  buildReceiveMessageTx,
  encodeDepositForBurn,
  encodeReceiveMessage,
  encodeSettleKitHookData,
  toOrderId,
  ZERO_ADDRESS,
  ZERO_BYTES32,
} from "./encode.js";

export {
  buildIrisUrl,
  createFetchCctpHttp,
  fetchAttestation,
  IRIS_MAINNET_BASE_URL,
  IRIS_SANDBOX_BASE_URL,
  parseFirstMessage,
  parseMessage,
  waitForAttestation,
} from "./attestation.js";
export type {
  CctpHttp,
  CctpRequest,
  CctpResponse,
  FetchCctpHttpOptions,
  WaitForAttestationOptions,
} from "./attestation.js";

export { createCctpClient } from "./client.js";
export type {
  BurnForPayInInput,
  CctpClient,
  CctpClientConfig,
} from "./client.js";

export {
  FINALITY_THRESHOLD_FAST,
  FINALITY_THRESHOLD_STANDARD,
} from "./types.js";
export type {
  BuildDepositForBurnInput,
  BuildReceiveMessageInput,
  CctpDecodedMessage,
  CctpMessage,
  CctpMessageStatus,
  CctpTxRequest,
  Hex,
  IrisMessagesResponse,
  IrisRawMessage,
} from "./types.js";
