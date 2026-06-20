/**
 * Pure, network-free USDC amount helpers — the deterministic, testable core.
 *
 * USDC is a 6-decimal token (1 USDC = 1_000_000 base units). We delegate to
 * `@settlekit/common` `toBaseUnits`/`fromBaseUnits`, which do integer-only
 * (BigInt) math and never touch floating point. The viem `parseUnits`/
 * `formatUnits` equivalents (with 6) are exported too and asserted to agree, to
 * document that the two are interchangeable for USDC.
 */

import { formatUnits, parseUnits } from "viem";
import {
  USDC_DECIMALS,
  fromBaseUnits,
  money,
  toBaseUnits,
  type Money,
} from "@settlekit/common";

/** Convert a decimal USDC string ("100.00") to bigint base units (6 dp). */
export function toUsdcBaseUnits(decimal: string): bigint {
  return toBaseUnits(decimal);
}

/** Convert bigint base units to a normalized decimal USDC string. */
export function fromUsdcBaseUnits(base: bigint): string {
  return fromBaseUnits(base);
}

/** viem-based parse equivalent (USDC 6-decimals). Agrees with {@link toUsdcBaseUnits}. */
export function parseUsdc(decimal: string): bigint {
  return parseUnits(decimal, USDC_DECIMALS);
}

/** viem-based format equivalent (USDC 6-decimals). */
export function formatUsdc(base: bigint): string {
  return formatUnits(base, USDC_DECIMALS);
}

/** Map on-chain bigint base units to an erc8183 {@link Money} value. */
export function jobAmountToMoney(base: bigint): Money {
  return money(fromUsdcBaseUnits(base));
}
