/**
 * Pure ERC-4337 UserOperation helpers — no I/O.
 *
 * Responsibilities:
 *  - Canonical EntryPoint + Circle Paymaster addresses per (chain, version).
 *  - Build the EIP-2612 permit typed data that authorizes Circle Paymaster to
 *    pull USDC for gas.
 *  - Encode Circle's `paymasterData` blob:
 *      encodePacked(['uint8','address','uint256','bytes'],
 *                   [0, usdcAddress, maxGasUsdc, permitSignature])
 *  - Attach paymaster fields to a UserOperation immutably.
 *  - Compute the v0.7/v0.8 UserOperation hash for signing.
 *
 * References:
 *  - Circle Paymaster quickstart (paymasterData layout, permit):
 *    https://developers.circle.com/paymaster/pay-gas-fees-usdc
 *  - Addresses & events: https://developers.circle.com/paymaster/addresses-and-events
 *  - ERC-4337 v0.7 packed-UserOp hashing (eth-infinitism EntryPoint).
 */

import { SettleKitError } from "@settlekit/common";
import {
  concat,
  encodeAbiParameters,
  encodePacked,
  keccak256,
  pad,
  toHex,
} from "viem";
import type { ArcChain } from "@settlekit/arc";
import type {
  Address,
  EntryPointVersion,
  Hex,
  PermitMessage,
  PermitTypedData,
  UserOperation,
  UserOperationGas,
} from "./types.js";

/** Canonical ERC-4337 EntryPoint singletons (same address on every chain). */
export const ENTRYPOINT_ADDRESS: Record<EntryPointVersion, Address> = {
  "0.7": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "0.8": "0x4337084D9E255Ff0702461CF8895cE9E3b5Ff108",
};

/**
 * Circle Paymaster contract addresses by network family and EntryPoint version.
 * Source: https://developers.circle.com/paymaster/addresses-and-events
 *
 * Arc Testnet shares the testnet singletons. Arc Mainnet is not yet published
 * by Circle; resolve it via {@link resolvePaymasterAddress}'s override param.
 */
export const CIRCLE_PAYMASTER_ADDRESS = {
  testnet: {
    "0.7": "0x31BE08D380A21fc740883c0BC434FcFc88740b58",
    "0.8": "0x3BA9A96eE3eFf3A69E2B18886AcF52027EFF8966",
  },
  mainnet: {
    "0.7": "0x6C973eBe80dCD8660841D4356bf15c32460271C9",
    "0.8": "0x0578cFB241215b77442a541325d6A4E6dFE700Ec",
  },
} as const satisfies Record<"testnet" | "mainnet", Record<EntryPointVersion, Address>>;

/**
 * Resolve the Circle Paymaster address for an Arc chain + EntryPoint version.
 *
 * Arc Testnet maps to Circle's published testnet singletons. For Arc Mainnet
 * (not yet published by Circle) callers MUST pass `override` once Circle lists
 * it — otherwise this throws rather than guessing an address.
 */
export function resolvePaymasterAddress(
  chain: ArcChain,
  version: EntryPointVersion,
  override?: Address,
): Address {
  if (override) return override;
  if (chain.network === "testnet") {
    return CIRCLE_PAYMASTER_ADDRESS.testnet[version];
  }
  throw new SettleKitError({
    code: "validation_error",
    message:
      `Circle Paymaster address for ${chain.name} (mainnet, EntryPoint v${version}) ` +
      "is not published; pass it explicitly via the paymasterAddress option.",
    details: { chain: chain.name, network: chain.network, version },
  });
}

/** Max uint256 — used as the permit deadline (no expiry). */
export const MAX_UINT256 = (1n << 256n) - 1n;

/** Default max USDC the paymaster may spend on gas: 1 USDC (6 decimals). */
export const DEFAULT_MAX_GAS_USDC = 1_000_000n;

export interface BuildPermitParams {
  /** EIP-712 token name as returned by the USDC contract (e.g. "USDC"). */
  tokenName: string;
  /** EIP-712 token version (e.g. "2" for circle USDC, "1" for some chains). */
  tokenVersion: string;
  /** USDC token contract (the EIP-712 verifying contract). */
  usdcAddress: Address;
  chainId: number;
  /** The smart account that owns the USDC. */
  owner: Address;
  /** The Circle Paymaster (spender authorized to pull USDC). */
  spender: Address;
  /** Max USDC the permit authorizes (6-decimal base units). */
  value: bigint;
  /** Current EIP-2612 nonce of `owner` on the token. */
  nonce: bigint;
  /** Permit deadline (defaults to max uint256 = no expiry). */
  deadline?: bigint;
}

/**
 * Build the EIP-712 typed data for the EIP-2612 permit that authorizes Circle
 * Paymaster to pull `value` USDC from `owner`. Sign this with the account's
 * key, then feed the resulting signature into {@link encodePaymasterData}.
 */
export function buildPermitTypedData(params: BuildPermitParams): PermitTypedData {
  requirePositive(params.value, "permit.value");
  if (params.nonce < 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "permit.nonce must be non-negative",
    });
  }
  const message: PermitMessage = {
    owner: params.owner,
    spender: params.spender,
    value: params.value,
    nonce: params.nonce,
    deadline: params.deadline ?? MAX_UINT256,
  };
  return {
    domain: {
      name: params.tokenName,
      version: params.tokenVersion,
      chainId: params.chainId,
      verifyingContract: params.usdcAddress,
    },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message,
  };
}

/**
 * Encode Circle Paymaster's `paymasterData` blob.
 *
 * Layout (packed): `uint8(0) ‖ address(token) ‖ uint256(maxGasUsdc) ‖ bytes(permitSignature)`.
 * The leading `uint8` is reserved (0) for future use; `token` is the USDC
 * address; `maxGasUsdc` caps gas spend; `permitSignature` is the 65-byte
 * EIP-2612 permit signature (already unwrapped from any ERC-6492 wrapper).
 */
export function encodePaymasterData(args: {
  usdcAddress: Address;
  maxGasUsdc: bigint;
  permitSignature: Hex;
}): Hex {
  requirePositive(args.maxGasUsdc, "maxGasUsdc");
  return encodePacked(
    ["uint8", "address", "uint256", "bytes"],
    [0, args.usdcAddress, args.maxGasUsdc, args.permitSignature],
  );
}

/**
 * Immutably attach Circle Paymaster fields to a UserOperation. Returns a new
 * UserOperation; the input is never mutated.
 */
export function withPaymaster(
  userOp: Readonly<UserOperation>,
  fields: {
    paymaster: Address;
    paymasterData: Hex;
    paymasterVerificationGasLimit?: bigint;
    paymasterPostOpGasLimit?: bigint;
  },
): UserOperation {
  return {
    ...userOp,
    paymaster: fields.paymaster,
    paymasterData: fields.paymasterData,
    paymasterVerificationGasLimit: fields.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: fields.paymasterPostOpGasLimit,
  };
}

export interface AssembleUserOperationInput {
  sender: Address;
  nonce: bigint;
  callData: Hex;
  factory?: Address;
  factoryData?: Hex;
  gas?: UserOperationGas;
  signature?: Hex;
}

/**
 * Assemble a normalized UserOperation from required fields + optional gas
 * overrides. Missing gas fields default to 0n so the result is always a
 * complete, well-typed UserOperation ready for estimation/signing. Pure: no I/O.
 */
export function assembleUserOperation(input: AssembleUserOperationInput): UserOperation {
  const g = input.gas ?? {};
  return {
    sender: input.sender,
    nonce: input.nonce,
    factory: input.factory,
    factoryData: input.factoryData,
    callData: input.callData,
    callGasLimit: g.callGasLimit ?? 0n,
    verificationGasLimit: g.verificationGasLimit ?? 0n,
    preVerificationGas: g.preVerificationGas ?? 0n,
    maxFeePerGas: g.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: g.maxPriorityFeePerGas ?? 0n,
    paymasterVerificationGasLimit: g.paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: g.paymasterPostOpGasLimit,
    signature: input.signature ?? "0x",
  };
}

/** Pack two 16-byte gas values into one 32-byte word (ERC-4337 v0.7 packing). */
function packUint128Pair(high: bigint, low: bigint): Hex {
  return concat([padUint128(high), padUint128(low)]) as Hex;
}

function padUint128(value: bigint): Hex {
  if (value < 0n || value > (1n << 128n) - 1n) {
    throw new SettleKitError({
      code: "validation_error",
      message: "gas value does not fit in uint128",
      details: { value: value.toString() },
    });
  }
  return pad(toHex(value), { size: 16 });
}

/** Encode the packed initCode hash component for hashing. */
function initCodeHash(userOp: Readonly<UserOperation>): Hex {
  if (!userOp.factory) return keccak256("0x");
  const factoryData = userOp.factoryData ?? "0x";
  return keccak256(concat([userOp.factory, factoryData]));
}

/** Encode the packed paymasterAndData hash component for hashing. */
function paymasterAndDataHash(userOp: Readonly<UserOperation>): Hex {
  if (!userOp.paymaster) return keccak256("0x");
  const verificationGas = padUint128(userOp.paymasterVerificationGasLimit ?? 0n);
  const postOpGas = padUint128(userOp.paymasterPostOpGasLimit ?? 0n);
  const data = userOp.paymasterData ?? "0x";
  return keccak256(concat([userOp.paymaster, verificationGas, postOpGas, data]));
}

/**
 * Compute the ERC-4337 v0.7 UserOperation hash that the account signs.
 *
 * Follows the EntryPoint v0.7 scheme: hash the packed-UserOp field encoding,
 * then `keccak256(abi.encode(packedHash, entryPoint, chainId))`.
 */
export function getUserOperationHashV07(
  userOp: Readonly<UserOperation>,
  entryPoint: Address,
  chainId: number,
): Hex {
  const accountGasLimits = packUint128Pair(
    userOp.verificationGasLimit,
    userOp.callGasLimit,
  );
  const gasFees = packUint128Pair(userOp.maxPriorityFeePerGas, userOp.maxFeePerGas);

  const packedHash = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        userOp.sender,
        userOp.nonce,
        initCodeHash(userOp),
        keccak256(userOp.callData),
        accountGasLimits,
        userOp.preVerificationGas,
        gasFees,
        paymasterAndDataHash(userOp),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [packedHash, entryPoint, BigInt(chainId)],
    ),
  );
}

function requirePositive(value: bigint, field: string): void {
  if (value <= 0n) {
    throw new SettleKitError({
      code: "validation_error",
      message: `${field} must be a positive integer`,
      details: { field, value: value.toString() },
    });
  }
}
