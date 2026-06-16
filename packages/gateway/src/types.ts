/**
 * Public types for the Circle Gateway (Unified Balance) client.
 *
 * Mirrors the on-chain `BurnIntent` / `TransferSpec` structs and the Gateway
 * API request/response envelopes documented at developers.circle.com.
 */

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

/** A 0x-prefixed 20-byte (40 hex char) EVM address. */
export type Address = `0x${string}`;

/**
 * The `TransferSpec` struct (Circle Gateway). `bytes32` fields are 32-byte hex
 * strings (addresses left-padded to 32 bytes); `uint256` fields are decimal
 * strings; `hookData` is hex bytes ("0x" when empty).
 *
 * @see https://github.com/circlefin/evm-gateway-contracts `src/lib/TransferSpec.sol`
 */
export interface TransferSpec {
  /** Format version. Always 1 for the current encoding. */
  version: number;
  /** CCTP domain of the source GatewayWallet. */
  sourceDomain: number;
  /** CCTP domain of the destination GatewayMinter. */
  destinationDomain: number;
  /** GatewayWallet contract on the source domain, as bytes32. */
  sourceContract: Hex;
  /** GatewayMinter contract on the destination domain, as bytes32. */
  destinationContract: Hex;
  /** USDC token on the source domain, as bytes32. */
  sourceToken: Hex;
  /** USDC token on the destination domain, as bytes32. */
  destinationToken: Hex;
  /** Depositor whose available balance is debited, as bytes32. */
  sourceDepositor: Hex;
  /** Recipient of minted funds on the destination domain, as bytes32. */
  destinationRecipient: Hex;
  /** Signer of the burn intent (often equal to sourceDepositor), as bytes32. */
  sourceSigner: Hex;
  /** Permitted caller of the attestation, or zero for any caller, as bytes32. */
  destinationCaller: Hex;
  /** Amount to mint, in 6-decimal USDC base units, as a decimal string. */
  value: string;
  /** Random 32-byte salt making the transfer spec hash unique. */
  salt: Hex;
  /** Arbitrary hook data for on-chain composition ("0x" when none). */
  hookData: Hex;
}

/**
 * The `BurnIntent` struct. `maxBlockHeight` and `maxFee` are `uint256` decimal
 * strings.
 *
 * @see https://github.com/circlefin/evm-gateway-contracts `src/lib/BurnIntents.sol`
 */
export interface BurnIntent {
  /** Last source-domain block at which the burn is valid (decimal string). */
  maxBlockHeight: string;
  /** Maximum fee collectable by the Gateway operator, in USDC base units (decimal string). */
  maxFee: string;
  /** The transfer description. */
  spec: TransferSpec;
}

/** A burn intent paired with its EOA EIP-712 signature, as posted to the Gateway API. */
export interface SignedBurnIntent {
  burnIntent: BurnIntent;
  /** EIP-712 signature over the burn intent (0x-prefixed). */
  signature: Hex;
}

/** A per-intent fee breakdown returned by the Gateway API. */
export interface GatewayPerIntentFee {
  transferSpecHash: Hex;
  domain: number;
  baseFee: string;
  transferFee: string;
}

/** Fee block returned by the Gateway API transfer response. */
export interface GatewayFees {
  total: string;
  token: string;
  perIntent: GatewayPerIntentFee[];
  forwardingFee?: string;
}

/**
 * Response from the Gateway API `POST /v1/transfer` endpoint: a signed
 * attestation plus the operator signature, to be submitted to `gatewayMint`.
 */
export interface TransferAttestation {
  /** Unique id of the transfer. */
  transferId: string;
  /** The attestation bytes to pass to `GatewayMinter.gatewayMint`. */
  attestation: Hex;
  /** The operator signature bytes to pass to `GatewayMinter.gatewayMint`. */
  signature: Hex;
  /** Fee breakdown, when present. */
  fees?: GatewayFees;
  /** Destination-domain block height at which the attestation expires. */
  expirationBlock?: string;
}

/** A raw, unsigned EVM transaction request (calldata + target). */
export interface TxRequest {
  /** Target contract address. */
  to: Address;
  /** ABI-encoded calldata. */
  data: Hex;
  /** Native value to send (always 0n for these calls). */
  value: bigint;
}

/** A depositor's Gateway balances for a token, in 6-decimal USDC base units. */
export interface GatewayBalance {
  /** `availableBalance` + `withdrawingBalance`. */
  total: bigint;
  /** Spendable via burn intents. */
  available: bigint;
  /** Locked in an in-progress withdrawal. */
  withdrawing: bigint;
  /** Withdrawable as of the current block (0 or `withdrawing`). */
  withdrawable: bigint;
}
