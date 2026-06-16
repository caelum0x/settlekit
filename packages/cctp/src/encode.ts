/**
 * Pure CCTP V2 encoding helpers.
 *
 * No I/O: these functions only transform inputs into calldata / tx requests
 * using viem's ABI encoder, so they are fully unit-testable without a network.
 */

import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  pad,
  toHex,
} from "viem";
import { SettleKitError } from "@settlekit/common";
import { MESSAGE_TRANSMITTER_V2_ABI, TOKEN_MESSENGER_V2_ABI } from "./abi.js";
import {
  FINALITY_THRESHOLD_STANDARD,
  type BuildDepositForBurnInput,
  type BuildReceiveMessageInput,
  type CctpTxRequest,
  type Hex,
} from "./types.js";

/** The 20-byte zero address, used as the "any caller" / no-hook sentinel. */
const ZERO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

/** The 32-byte zero value (bytes32), e.g. an unrestricted `destinationCaller`. */
export const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Left-pad a 20-byte EVM address into the 32-byte (`bytes32`) form CCTP uses
 * for `mintRecipient` / `destinationCaller`. The address is checksum-normalized
 * first; an invalid address is rejected rather than silently mis-encoded.
 */
export function addressToBytes32(address: Hex): Hex {
  if (!isAddress(address)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `addressToBytes32: invalid EVM address "${address}"`,
    });
  }
  // Validate via checksum, then left-pad the lowercased address to 32 bytes so
  // the bytes32 form is deterministic regardless of input casing. (viem `pad`
  // defaults to left-padding.)
  getAddress(address); // throws on bad checksum/format
  return pad(address.toLowerCase() as Hex, { size: 32 });
}

/** Validate and checksum-normalize an EVM address, raising a typed error if invalid. */
function requireAddress(address: Hex, field: string): Hex {
  if (!isAddress(address)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${field} must be a valid EVM address, got "${address}"`,
    });
  }
  return getAddress(address);
}

/** Validate a non-negative bigint amount/fee field. */
function requireUnsigned(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${field} must be a non-negative bigint`,
    });
  }
  return value;
}

/**
 * Encode `depositForBurn` (or `depositForBurnWithHook` when `hookData` is
 * present) calldata. Returns only the `0x`-prefixed data; use
 * {@link buildDepositForBurnTx} for a full tx request.
 */
export function encodeDepositForBurn(input: BuildDepositForBurnInput): Hex {
  const amount = requireUnsigned(input.amount, "amount");
  const maxFee = requireUnsigned(input.maxFee, "maxFee");
  if (amount === 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "depositForBurn amount must be greater than 0",
    });
  }

  const mintRecipient = addressToBytes32(input.mintRecipient);
  const burnToken = requireAddress(input.burnToken, "burnToken");
  const destinationCaller =
    input.destinationCaller === undefined
      ? ZERO_BYTES32
      : addressToBytes32(input.destinationCaller);
  const minFinalityThreshold =
    input.minFinalityThreshold ?? FINALITY_THRESHOLD_STANDARD;

  if (!Number.isInteger(input.destinationDomain) || input.destinationDomain < 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: "destinationDomain must be a non-negative integer",
    });
  }

  if (input.hookData !== undefined && input.hookData !== "0x") {
    return encodeFunctionData({
      abi: TOKEN_MESSENGER_V2_ABI,
      functionName: "depositForBurnWithHook",
      args: [
        amount,
        input.destinationDomain,
        mintRecipient,
        burnToken,
        destinationCaller,
        maxFee,
        minFinalityThreshold,
        input.hookData,
      ],
    });
  }

  return encodeFunctionData({
    abi: TOKEN_MESSENGER_V2_ABI,
    functionName: "depositForBurn",
    args: [
      amount,
      input.destinationDomain,
      mintRecipient,
      burnToken,
      destinationCaller,
      maxFee,
      minFinalityThreshold,
    ],
  });
}

/**
 * Build a full, signer-agnostic `depositForBurn` transaction request targeting
 * the source chain's `TokenMessengerV2`. The caller signs and sends it.
 */
export function buildDepositForBurnTx(
  input: BuildDepositForBurnInput,
): CctpTxRequest {
  const to = requireAddress(input.tokenMessenger, "tokenMessenger");
  return {
    to,
    data: encodeDepositForBurn(input),
    value: 0n,
  };
}

/** Encode `receiveMessage(message, attestation)` calldata. */
export function encodeReceiveMessage(input: BuildReceiveMessageInput): Hex {
  if (!isHexBytes(input.message)) {
    throw new SettleKitError({
      code: "validation_error",
      message: "receiveMessage requires a 0x-prefixed message",
    });
  }
  if (!isHexBytes(input.attestation)) {
    throw new SettleKitError({
      code: "validation_error",
      message: "receiveMessage requires a 0x-prefixed attestation",
    });
  }
  return encodeFunctionData({
    abi: MESSAGE_TRANSMITTER_V2_ABI,
    functionName: "receiveMessage",
    args: [input.message, input.attestation],
  });
}

/**
 * Build a full `receiveMessage` transaction request targeting the destination
 * chain's `MessageTransmitterV2`, completing the cross-chain transfer.
 */
export function buildReceiveMessageTx(
  input: BuildReceiveMessageInput,
): CctpTxRequest {
  const to = requireAddress(input.messageTransmitter, "messageTransmitter");
  return {
    to,
    data: encodeReceiveMessage(input),
    value: 0n,
  };
}

/** True when `value` is a `0x`-prefixed, even-length hex byte string. */
function isHexBytes(value: string): value is Hex {
  return /^0x([0-9a-fA-F]{2})*$/.test(value);
}

/**
 * Derive a deterministic `bytes32` order id from an arbitrary string
 * (e.g. a checkout-session id), via keccak256. Pass a 0x-prefixed 32-byte hex
 * through unchanged.
 */
export function toOrderId(value: string): Hex {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) return value as Hex;
  return keccak256(toHex(value));
}

/**
 * Encode the `hookData` payload the `SettleKitCctpHook` contract expects:
 * `abi.encode(address merchant, bytes32 orderId)`. Attach this to a hooked
 * `depositForBurnWithHook` (with the hook contract as `mintRecipient`) so the
 * cross-chain mint atomically forwards USDC to the merchant + emits the order.
 */
export function encodeSettleKitHookData(input: { merchant: Hex; orderId: string }): Hex {
  if (!isAddress(input.merchant)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `encodeSettleKitHookData: invalid merchant address "${input.merchant}"`,
    });
  }
  return encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [getAddress(input.merchant), toOrderId(input.orderId)],
  );
}

export { ZERO_ADDRESS };
