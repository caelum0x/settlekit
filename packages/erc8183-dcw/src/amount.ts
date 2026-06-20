/**
 * Pure, network-free USDC amount helpers for the DCW adapter — WITHOUT viem.
 *
 * The DCW contract-execution path posts `abiParameters` as **decimal strings**
 * (uint256 values are decimal-string-encoded), so a USDC amount must become the
 * base-unit integer as a STRING (not a bigint). USDC is a 6-decimal token; all
 * conversion delegates to `@settlekit/common` (integer-only BigInt math, never
 * floating point). Nothing here is hand-rolled.
 */

import { fromBaseUnits, money, toBaseUnits, type Money } from "@settlekit/common";

/**
 * Convert a decimal USDC string ("100.00") to its 6-decimal base-unit value as a
 * decimal STRING ("100000000") — the form DCW `abiParameters` require for a
 * uint256. Validation (range, decimal places) is enforced by `toBaseUnits`.
 */
export function toUsdcBaseUnitsString(decimal: string): string {
  return String(toBaseUnits(decimal));
}

/**
 * Map an on-chain base-unit value (decimal string, e.g. "100000000") to an
 * `@settlekit/erc8183` {@link Money} value. The string is parsed with `BigInt`
 * so no precision is lost.
 */
export function jobAmountToMoney(baseUnitsString: string): Money {
  return money(fromBaseUnits(BigInt(baseUnitsString)));
}
