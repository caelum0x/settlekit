/**
 * Pure encoders for Circle Gateway flows: deposit/withdraw transaction
 * requests, burn-intent payload construction, and the `gatewayMint`
 * transaction request. No I/O — every function is deterministic given its
 * inputs, so the whole module is exercised in unit tests without a chain.
 */

import { SettleKitError } from "@settlekit/common";
import { encodeFunctionData, getAddress, isAddress, pad } from "viem";
import {
  ERC20_APPROVE_ABI,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
} from "./abi.js";
import type {
  Address,
  BurnIntent,
  Hex,
  SignedBurnIntent,
  TransferSpec,
  TxRequest,
} from "./types.js";

/** Current `TransferSpec` encoding version (always 1). */
export const TRANSFER_SPEC_VERSION = 1;

/** The bytes32 zero value (e.g. an unrestricted `destinationCaller`). */
export const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

/** Validate and checksum an EVM address, raising a SettleKitError on bad input. */
function requireAddress(value: string, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Gateway: ${field} must be a 20-byte EVM address, got ${String(value)}`,
    });
  }
  return getAddress(value);
}

/** Validate a non-negative integer amount expressed as a bigint. */
function requireUint(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Gateway: ${field} must be a non-negative integer amount`,
    });
  }
  return value;
}

/**
 * Left-pad a 20-byte EVM address into a 32-byte (bytes32) hex string, the
 * encoding Gateway uses for all address fields in a `TransferSpec`.
 */
export function addressToBytes32(address: string): Hex {
  return pad(requireAddress(address, "address"), { size: 32 });
}

/**
 * Build the calldata + target for `ERC20.approve(gatewayWallet, value)`. A
 * depositor must grant this allowance before `deposit` can pull USDC.
 */
export function buildApproveTxRequest(params: {
  token: string;
  gatewayWallet: string;
  value: bigint;
}): TxRequest {
  const token = requireAddress(params.token, "token");
  const spender = requireAddress(params.gatewayWallet, "gatewayWallet");
  const value = requireUint(params.value, "value");
  return {
    to: token,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, value],
    }),
    value: 0n,
  };
}

/**
 * Build the calldata + target for `GatewayWallet.deposit(token, value)`, adding
 * `value` USDC base units to the caller's available unified balance.
 */
export function buildDepositTxRequest(params: {
  gatewayWallet: string;
  token: string;
  value: bigint;
}): TxRequest {
  const to = requireAddress(params.gatewayWallet, "gatewayWallet");
  const token = requireAddress(params.token, "token");
  const value = requireUint(params.value, "value");
  if (value === 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: deposit value must be greater than zero",
    });
  }
  return {
    to,
    data: encodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      functionName: "deposit",
      args: [token, value],
    }),
    value: 0n,
  };
}

/**
 * Build `GatewayWallet.depositFor(token, depositor, value)` — credits the
 * unified balance of `depositor` from the caller's funds.
 */
export function buildDepositForTxRequest(params: {
  gatewayWallet: string;
  token: string;
  depositor: string;
  value: bigint;
}): TxRequest {
  const to = requireAddress(params.gatewayWallet, "gatewayWallet");
  const token = requireAddress(params.token, "token");
  const depositor = requireAddress(params.depositor, "depositor");
  const value = requireUint(params.value, "value");
  if (value === 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: depositFor value must be greater than zero",
    });
  }
  return {
    to,
    data: encodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      functionName: "depositFor",
      args: [token, depositor, value],
    }),
    value: 0n,
  };
}

/**
 * Build `GatewayWallet.initiateWithdrawal(token, value)`. Starts the trustless
 * withdrawal of `value` from the available balance; it completes after the
 * configured withdrawal delay via {@link buildWithdrawTxRequest}.
 */
export function buildInitiateWithdrawalTxRequest(params: {
  gatewayWallet: string;
  token: string;
  value: bigint;
}): TxRequest {
  const to = requireAddress(params.gatewayWallet, "gatewayWallet");
  const token = requireAddress(params.token, "token");
  const value = requireUint(params.value, "value");
  if (value === 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: withdrawal value must be greater than zero",
    });
  }
  return {
    to,
    data: encodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      functionName: "initiateWithdrawal",
      args: [token, value],
    }),
    value: 0n,
  };
}

/**
 * Build `GatewayWallet.withdraw(token)` — completes a previously-initiated
 * withdrawal, transferring the full withdrawing balance back to the depositor.
 */
export function buildWithdrawTxRequest(params: {
  gatewayWallet: string;
  token: string;
}): TxRequest {
  const to = requireAddress(params.gatewayWallet, "gatewayWallet");
  const token = requireAddress(params.token, "token");
  return {
    to,
    data: encodeFunctionData({
      abi: GATEWAY_WALLET_ABI,
      functionName: "withdraw",
      args: [token],
    }),
    value: 0n,
  };
}

/** Inputs to {@link buildBurnIntent}; addresses are 20-byte EVM addresses. */
export interface BuildBurnIntentParams {
  /** CCTP domain of the source GatewayWallet. */
  sourceDomain: number;
  /** CCTP domain of the destination GatewayMinter. */
  destinationDomain: number;
  /** GatewayWallet contract on the source domain. */
  sourceContract: string;
  /** GatewayMinter contract on the destination domain. */
  destinationContract: string;
  /** USDC token on the source domain. */
  sourceToken: string;
  /** USDC token on the destination domain. */
  destinationToken: string;
  /** Depositor whose unified balance funds the burn. */
  sourceDepositor: string;
  /** Recipient of the minted USDC on the destination domain. */
  destinationRecipient: string;
  /** Signer of the intent. Defaults to `sourceDepositor`. */
  sourceSigner?: string;
  /** Caller permitted to redeem the attestation. Defaults to any caller. */
  destinationCaller?: string;
  /** Amount to transfer, in 6-decimal USDC base units. */
  value: bigint;
  /** Last source-domain block at which the burn is valid. */
  maxBlockHeight: bigint;
  /** Maximum fee the Gateway operator may collect, in USDC base units. */
  maxFee: bigint;
  /** Unique 32-byte salt. Must differ across otherwise-identical transfers. */
  salt: Hex;
  /** Optional on-chain hook data. Defaults to "0x". */
  hookData?: Hex;
}

/** Validate a 0x-prefixed 32-byte hex string (bytes32). */
function requireBytes32(value: string, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Gateway: ${field} must be a 0x-prefixed 32-byte hex value`,
    });
  }
  return value.toLowerCase() as Hex;
}

/** Validate a CCTP domain id (non-negative integer). */
function requireDomain(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Gateway: ${field} must be a non-negative integer domain id`,
    });
  }
  return value;
}

/**
 * Build a {@link TransferSpec} from 20-byte addresses, padding every address
 * field to bytes32 and serializing amounts as decimal strings.
 */
export function buildTransferSpec(params: BuildBurnIntentParams): TransferSpec {
  const value = requireUint(params.value, "value");
  if (value === 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: burn intent value must be greater than zero",
    });
  }
  return {
    version: TRANSFER_SPEC_VERSION,
    sourceDomain: requireDomain(params.sourceDomain, "sourceDomain"),
    destinationDomain: requireDomain(params.destinationDomain, "destinationDomain"),
    sourceContract: addressToBytes32(params.sourceContract),
    destinationContract: addressToBytes32(params.destinationContract),
    sourceToken: addressToBytes32(params.sourceToken),
    destinationToken: addressToBytes32(params.destinationToken),
    sourceDepositor: addressToBytes32(params.sourceDepositor),
    destinationRecipient: addressToBytes32(params.destinationRecipient),
    sourceSigner: addressToBytes32(params.sourceSigner ?? params.sourceDepositor),
    destinationCaller:
      params.destinationCaller === undefined
        ? ZERO_BYTES32
        : addressToBytes32(params.destinationCaller),
    value: value.toString(),
    salt: requireBytes32(params.salt, "salt"),
    hookData: params.hookData ?? "0x",
  };
}

/**
 * Build a complete, unsigned {@link BurnIntent}. The result is ready to be
 * signed via EIP-712 (see `eip712.ts`) and submitted to the Gateway API.
 */
export function buildBurnIntent(params: BuildBurnIntentParams): BurnIntent {
  return {
    maxBlockHeight: requireUint(params.maxBlockHeight, "maxBlockHeight").toString(),
    maxFee: requireUint(params.maxFee, "maxFee").toString(),
    spec: buildTransferSpec(params),
  };
}

/**
 * Serialize a signed burn intent into the exact JSON the Gateway API
 * `POST /v1/transfer` endpoint accepts: an array element of
 * `{ burnIntent, signature }`. Amounts are already decimal strings and address
 * fields already bytes32, so this is a structural pass-through with validation.
 */
export function toGatewayApiPayload(signed: SignedBurnIntent): SignedBurnIntent {
  if (
    typeof signed.signature !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(signed.signature)
  ) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: signed burn intent requires a 0x-prefixed signature",
    });
  }
  return { burnIntent: signed.burnIntent, signature: signed.signature };
}

/**
 * Build the calldata + target for
 * `GatewayMinter.gatewayMint(attestation, signature)` using the attestation
 * returned by the Gateway API. Executed on the destination domain to mint USDC.
 */
export function buildGatewayMintTxRequest(params: {
  gatewayMinter: string;
  attestation: Hex;
  signature: Hex;
}): TxRequest {
  const to = requireAddress(params.gatewayMinter, "gatewayMinter");
  if (!/^0x[0-9a-fA-F]*$/.test(params.attestation)) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: attestation must be a 0x-prefixed hex string",
    });
  }
  if (!/^0x[0-9a-fA-F]+$/.test(params.signature)) {
    throw new SettleKitError({
      code: "validation_error",
      message: "Gateway: attestation signature must be a 0x-prefixed hex string",
    });
  }
  return {
    to,
    data: encodeFunctionData({
      abi: GATEWAY_MINTER_ABI,
      functionName: "gatewayMint",
      args: [params.attestation, params.signature],
    }),
    value: 0n,
  };
}
