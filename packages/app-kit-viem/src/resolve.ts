/**
 * Pure chain / token resolution helpers. No transport, no I/O.
 *
 * arc-chains intentionally leaves the Arc USDC address `undefined` (addresses
 * are never invented). This module surfaces a CLEAR error for that case and
 * supports a config override so a deployment can inject the verified USDC
 * address without editing arc-chains.
 */

import type { Address } from "viem";
import {
  CHAIN_TOKENS,
  SUPPORTED_CHAINS,
  SUPPORTED_TOKENS,
  getChain,
  getToken,
} from "@settlekit/arc-chains";
import type {
  ChainDescriptor,
  SupportedChain,
  SupportedToken,
} from "@settlekit/arc-chains";
import { SettleKitError } from "@settlekit/common";
import { checksumAddress } from "./encode.js";

/**
 * Per-chain, per-token address overrides. Lets callers inject the real USDC
 * address (which arc-chains leaves `undefined`) without editing arc-chains.
 */
export type TokenAddressOverrides = Partial<
  Record<SupportedChain, Partial<Record<SupportedToken, string>>>
>;

function isSupportedChain(chainKey: string): chainKey is SupportedChain {
  return (SUPPORTED_CHAINS as readonly string[]).includes(chainKey);
}

function isSupportedToken(token: string): token is SupportedToken {
  return (SUPPORTED_TOKENS as readonly string[]).includes(token);
}

/**
 * Validate a (possibly untrusted) token string against the arc-chains
 * allow-list.
 *
 * @throws {SettleKitError} `validation_error` when the token is unknown.
 */
export function resolveToken(token: string): SupportedToken {
  if (!isSupportedToken(token)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `unknown token "${token}" — expected one of: ${SUPPORTED_TOKENS.join(", ")}`,
    });
  }
  return token;
}

/**
 * Validate `chainKey` against the arc-chains allow-list and return its
 * descriptor.
 *
 * @throws {SettleKitError} `validation_error` when the key is unknown.
 */
export function resolveChain(chainKey: string): ChainDescriptor {
  if (!isSupportedChain(chainKey)) {
    throw new SettleKitError({
      code: "validation_error",
      message: `unknown chain "${chainKey}" — expected one of: ${SUPPORTED_CHAINS.join(", ")}`,
    });
  }
  return getChain(chainKey);
}

/**
 * Resolve the on-chain address for `token` on `chainKey`, preferring an injected
 * override over arc-chains' (currently `undefined`) value.
 *
 * @throws {SettleKitError} `validation_error` when the chain is unknown, when no
 *   address is configured (the mandated clear error), or when an override is not
 *   a 0x address.
 */
export function resolveUsdcAddress(
  chainKey: string,
  token: SupportedToken = "USDC",
  overrides?: TokenAddressOverrides,
): Address {
  const descriptor = resolveChain(chainKey);

  const override = overrides?.[descriptor.key]?.[token];
  if (override !== undefined) {
    // Validates the 0x shape and returns a checksummed address.
    return checksumAddress(override);
  }

  const published = CHAIN_TOKENS[descriptor.key]?.[token]?.address;
  if (published !== undefined) {
    return checksumAddress(published);
  }

  throw new SettleKitError({
    code: "validation_error",
    message: `${token} token address is not configured for chain ${descriptor.key} — supply config.tokenAddressOverrides.${descriptor.key}.${token} or wait for @settlekit/arc-chains to publish it; addresses are never invented`,
  });
}

/** Resolve the ERC-20 decimals for `token` from arc-chains (USDC=6). */
export function resolveDecimals(token: SupportedToken = "USDC"): number {
  return getToken(token).decimals;
}
