/**
 * @settlekit/gateway — Circle Gateway (Unified Balance) for USDC.
 *
 * A single spendable USDC balance across chains: deposit into the
 * `GatewayWallet`, sign a `BurnIntent`, fetch a Gateway attestation, and mint
 * on any supported chain via `GatewayMinter`. Pure encoders + EIP-712 are split
 * from I/O behind injected `GatewayHttp` / `GatewayRpc` seams.
 *
 * Gateway contracts on Arc testnet are `ARC_TESTNET.contracts.gatewayWallet`
 * and `ARC_TESTNET.contracts.gatewayMinter` (domain 26).
 */

export { createGatewayClient } from "./client.js";
export type {
  GatewayClient,
  GatewayClientConfig,
  ReadChainBalanceParams,
} from "./client.js";

export {
  addressToBytes32,
  buildApproveTxRequest,
  buildBurnIntent,
  buildDepositForTxRequest,
  buildDepositTxRequest,
  buildGatewayMintTxRequest,
  buildInitiateWithdrawalTxRequest,
  buildTransferSpec,
  buildWithdrawTxRequest,
  toGatewayApiPayload,
  TRANSFER_SPEC_VERSION,
  ZERO_BYTES32,
} from "./encode.js";
export type { BuildBurnIntentParams } from "./encode.js";

export {
  burnIntentDigest,
  burnIntentTypedData,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
} from "./eip712.js";

export {
  assertGatewayOk,
  buildGatewayUrl,
  createFetchGatewayHttp,
  createGatewayApi,
  GATEWAY_API_MAINNET_BASE_URL,
  GATEWAY_API_TESTNET_BASE_URL,
  parseApiBalances,
  parseTransferAttestation,
} from "./api.js";
export type {
  ApiDomainBalance,
  BalanceSource,
  FetchGatewayHttpOptions,
  GatewayApi,
  GatewayHttp,
  GatewayRequest,
  GatewayResponse,
} from "./api.js";

export {
  createViemGatewayRpc,
  readGatewayBalance,
  sumUnifiedAvailable,
} from "./balance.js";
export type {
  BalanceGetter,
  ChainAvailable,
  GatewayRpc,
  ViemGatewayRpcConfig,
} from "./balance.js";

export {
  ERC20_APPROVE_ABI,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
} from "./abi.js";

export type {
  Address,
  BurnIntent,
  GatewayBalance,
  GatewayFees,
  GatewayPerIntentFee,
  Hex,
  SignedBurnIntent,
  TransferAttestation,
  TransferSpec,
  TxRequest,
} from "./types.js";
