/**
 * @settlekit/paymaster — gasless / USDC-gas transactions on Arc via Circle.
 *
 * Two complementary capabilities so checkout flows and agents never need a
 * native gas token:
 *
 *  - **Gas Station** ({@link createGasStationClient}): the developer sponsors
 *    users' gas by configuring sponsorship **policies** over Circle's Web3
 *    Services REST API.
 *  - **Circle Paymaster** ({@link createPaymasterClient}): a smart account pays
 *    its own gas in USDC by authorizing the permissionless ERC-4337 paymaster
 *    via an EIP-2612 permit encoded into the UserOperation.
 *
 * Pure ERC-4337 helpers (UserOp assembly, permit typed-data, `paymasterData`
 * encoding, UserOp hashing) are exported for direct use and testing.
 */

// Pure ERC-4337 helpers
export {
  ENTRYPOINT_ADDRESS,
  CIRCLE_PAYMASTER_ADDRESS,
  MAX_UINT256,
  DEFAULT_MAX_GAS_USDC,
  resolvePaymasterAddress,
  buildPermitTypedData,
  encodePaymasterData,
  withPaymaster,
  assembleUserOperation,
  getUserOperationHashV07,
} from "./userop.js";
export type { BuildPermitParams, AssembleUserOperationInput } from "./userop.js";

// Gas Station (developer-sponsored gas via policies)
export {
  createGasStationClient,
  DEFAULT_GAS_STATION_BASE_URL,
  DEFAULT_POLICIES_PATH,
} from "./gas-station.js";
export type { GasStationClient, GasStationConfig } from "./gas-station.js";

// Circle Paymaster (pay gas in USDC)
export { createPaymasterClient } from "./paymaster.js";
export type {
  PaymasterClient,
  SponsorWithUsdcConfig,
  SponsorWithUsdcInput,
  SponsorWithUsdcResult,
  TokenPermitReader,
  PermitSigner,
  BundlerGasEstimator,
} from "./paymaster.js";

// HTTP transport seam (for custom transports / testing)
export {
  createFetchPaymasterHttp,
  buildUrl,
} from "./http.js";
export type {
  PaymasterHttp,
  PaymasterRequest,
  PaymasterResponse,
  FetchPaymasterHttpOptions,
} from "./http.js";

// Shapes
export type {
  Address,
  Hex,
  EntryPointVersion,
  UserOperation,
  UserOperationGas,
  PermitDomain,
  PermitMessage,
  PermitTypedData,
  GasPolicy,
  GasPolicyStatus,
  GasPolicyLimits,
  CreateGasPolicyInput,
} from "./types.js";
