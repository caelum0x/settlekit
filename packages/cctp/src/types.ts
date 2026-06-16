/**
 * Public types for the CCTP V2 cross-chain USDC transfer client.
 */

/** A 0x-prefixed hex string (address, tx hash, calldata, message, …). */
export type Hex = `0x${string}`;

/**
 * Standard finality (hard finality / "Standard Transfer"). Any value below
 * 1000 selects Fast Transfer where the destination supports it.
 */
export const FINALITY_THRESHOLD_STANDARD = 1000;

/** Fast Transfer finality threshold (soft finality, where supported). */
export const FINALITY_THRESHOLD_FAST = 500;

/**
 * Inputs for building a `depositForBurn` transaction. Mirrors
 * `TokenMessengerV2.depositForBurn` parameters; addresses are EVM 20-byte hex
 * and are converted to bytes32 internally.
 */
export interface BuildDepositForBurnInput {
  /** Amount to burn, in USDC base units (6 decimals). */
  amount: bigint;
  /** CCTP domain id of the destination chain. */
  destinationDomain: number;
  /** Recipient of the minted USDC on the destination chain (20-byte EVM address). */
  mintRecipient: Hex;
  /** ERC-20 token being burned on the source chain (USDC). */
  burnToken: Hex;
  /**
   * Address allowed to call `receiveMessage` on the destination, or the zero
   * address to allow anyone. Defaults to "anyone" when omitted.
   */
  destinationCaller?: Hex;
  /** Maximum on-chain mint fee, in USDC base units. Use 0n for Standard transfers with no fee. */
  maxFee: bigint;
  /** Finality threshold: 1000 (Standard) or <=500 (Fast). Defaults to Standard. */
  minFinalityThreshold?: number;
  /** Optional hook payload; when present, `depositForBurnWithHook` is used. */
  hookData?: Hex;
  /**
   * `TokenMessengerV2` contract address on the source chain. Required because
   * the calldata target depends on which chain the burn happens on.
   */
  tokenMessenger: Hex;
}

/** Inputs for building a `receiveMessage` (mint) transaction on the destination chain. */
export interface BuildReceiveMessageInput {
  /** The raw CCTP message bytes returned by the Iris attestation API. */
  message: Hex;
  /** The attestation signatures returned by the Iris attestation API. */
  attestation: Hex;
  /** `MessageTransmitterV2` contract address on the destination chain. */
  messageTransmitter: Hex;
}

/**
 * A minimal, signer-agnostic transaction request. The caller signs/sends it
 * with their wallet of choice (viem WalletClient, Circle Wallets, etc.).
 */
export interface CctpTxRequest {
  /** Contract to call. */
  to: Hex;
  /** ABI-encoded calldata. */
  data: Hex;
  /** Native value to send (always 0 for CCTP burns/mints). */
  value: bigint;
}

/** V2 message status as reported by the Iris attestation API. */
export type CctpMessageStatus = "pending_confirmations" | "complete";

/** A decoded message body as returned (optionally) by Iris. */
export interface CctpDecodedMessage {
  sourceDomain?: string;
  destinationDomain?: string;
  nonce?: string;
  sender?: string;
  recipient?: string;
  destinationCaller?: string;
  messageBody?: string;
}

/** A single message + attestation entry from the Iris V2 API. */
export interface CctpMessage {
  /** The raw CCTP message bytes (input to `receiveMessage`). */
  message: Hex;
  /** Per-message nonce assigned by CCTP. */
  eventNonce: string;
  /**
   * The attestation signatures, or `null`/`"PENDING"` until the message is
   * attested. Only populated (and usable) when `status` is `complete`.
   */
  attestation: Hex | null;
  /** Attestation lifecycle status. */
  status: CctpMessageStatus;
  /** CCTP protocol version (2 for V2). */
  cctpVersion?: number;
  /** Reason a pre-finality message is delayed, when applicable. */
  delayReason?: string | null;
  /** Decoded message fields, when Circle includes them. */
  decodedMessage?: CctpDecodedMessage;
}

/** The Iris V2 `GET /v2/messages` response envelope. */
export interface IrisMessagesResponse {
  messages?: IrisRawMessage[];
}

/** A raw message entry as serialized by Iris (loosely typed before parsing). */
export interface IrisRawMessage {
  message?: string;
  eventNonce?: string;
  attestation?: string | null;
  status?: string;
  cctpVersion?: number;
  delayReason?: string | null;
  decodedMessage?: CctpDecodedMessage;
}
