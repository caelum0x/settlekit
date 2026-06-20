/**
 * Pure encoding / amount helpers — the deterministic, network-free core that
 * the unit tests assert against. No client, transport, or I/O is involved here.
 */

import { encodeFunctionData, getAddress, isAddress, parseUnits } from "viem";
import type { Address, Hex } from "viem";
import { SettleKitError } from "@settlekit/common";
import { ERC20_TRANSFER_ABI } from "./abi.js";

/**
 * Convert a human-readable decimal `amount` (e.g. "1.50") into base units for a
 * token with `decimals` decimals (USDC=6 => amount * 10^6).
 *
 * @throws {SettleKitError} `validation_error` when the amount is not a valid
 *   decimal string.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  try {
    return parseUnits(amount, decimals);
  } catch (cause) {
    throw new SettleKitError({
      code: "validation_error",
      message: `invalid token amount "${amount}" for ${decimals} decimals`,
      cause,
    });
  }
}

/**
 * Validate and checksum an EVM address.
 *
 * @throws {SettleKitError} `validation_error` when `value` is not a 0x address.
 */
export function checksumAddress(value: string): Address {
  if (!isAddress(value)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `invalid EVM address "${value}" — expected a 0x-prefixed 20-byte hex address`,
    });
  }
  return getAddress(value);
}

/**
 * Build ERC-20 `transfer(to, amount)` calldata. Deterministic: the same
 * `to`/`amount` always yields the same hex (selector 0xa9059cbb + padded args).
 *
 * @throws {SettleKitError} `validation_error` when `to` is not a 0x address.
 */
export function encodeTransfer(to: string, amount: bigint): Hex {
  const recipient = checksumAddress(to);
  return encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [recipient, amount],
  });
}
