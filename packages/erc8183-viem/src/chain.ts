/**
 * The Arc chain as a viem {@link Chain}, built with viem's `defineChain` from
 * `@settlekit/arc-chains` constants.
 *
 * We deliberately do NOT import an `arcTestnet` from `viem/chains` — it may not
 * exist, and the canonical Arc metadata lives in `@settlekit/arc-chains`.
 *
 * Arc Testnet's `chainId` is the 0 sentinel (unpublished). A real numeric id is
 * required for signing, so callers MUST override `chainId` until the real value
 * is published; we throw a `validation_error` rather than silently signing for
 * chain 0.
 */

import { defineChain } from "viem";
import type { Chain } from "viem";
import { getChain } from "@settlekit/arc-chains";
import { USDC_DECIMALS, validationError } from "@settlekit/common";

/** Overrides for {@link defineArcChain}. */
export interface DefineArcChainInput {
  /** EVM chain id. Required while the Arc constant is the 0 sentinel. */
  chainId?: number;
  /** RPC URL override (defaults to the arc-chains Arc Testnet rpcUrl). */
  rpcUrl?: string;
}

/**
 * Build the Arc Testnet viem {@link Chain}. Throws `validation_error` when the
 * resolved chain id is 0 (the unpublished sentinel) and no override is given.
 */
export function defineArcChain(input: DefineArcChainInput = {}): Chain {
  const descriptor = getChain("Arc_Testnet");
  const id = input.chainId ?? descriptor.chainId;
  if (id === 0) {
    throw validationError(
      "Arc Testnet chainId is unpublished (0 sentinel); pass config.chainId to override.",
      { chain: "Arc_Testnet" },
    );
  }
  const rpcUrl = input.rpcUrl ?? descriptor.rpcUrl;

  return defineChain({
    id,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: USDC_DECIMALS },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: "Arcscan", url: descriptor.explorerUrl } },
    testnet: true,
  });
}
