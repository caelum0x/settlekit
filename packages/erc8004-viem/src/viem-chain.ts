/**
 * Arc chain definition for viem, built from `@settlekit/arc-chains` metadata via
 * viem's `defineChain` — deliberately NOT relying on a `viem/chains` export
 * (no `arcTestnet` ships there).
 *
 * IMPORTANT (chainId): `getChain("Arc_Testnet").chainId` is the documented `0`
 * sentinel (`@settlekit/arc-chains` left it unset pending verification). viem
 * `writeContract` REQUIRES a real chain id to sign/send transactions, and `0`
 * breaks signing. We therefore default the chain id to `5042002` — the value
 * documented in `packages/arc/src/chains.ts` for Arc Testnet — and expose an
 * override on {@link defineArcChain}. Confirm the chain id against the live
 * network before mainnet use.
 *
 * Pure data builder: no client is constructed here.
 */

import { defineChain } from "viem";
import { getChain } from "@settlekit/arc-chains";

/**
 * Best-known Arc Testnet EVM chain id (from `packages/arc/src/chains.ts`), used
 * because `@settlekit/arc-chains` still carries the `0` sentinel. Override via
 * {@link defineArcChain} when a verified id is available.
 */
export const ARC_TESTNET_CHAIN_ID = 5_042_002;

/** Options for {@link defineArcChain}; all fields fall back to arc-chains data. */
export interface DefineArcChainOptions {
  /** EVM chain id. Defaults to {@link ARC_TESTNET_CHAIN_ID}. */
  chainId?: number;
  /** JSON-RPC endpoint. Defaults to `getChain("Arc_Testnet").rpcUrl`. */
  rpcUrl?: string;
  /** Block-explorer base URL. Defaults to `getChain("Arc_Testnet").explorerUrl`. */
  explorerUrl?: string;
}

/**
 * Build a viem {@link import("viem").Chain} for Arc Testnet.
 *
 * The chain id falls back to {@link ARC_TESTNET_CHAIN_ID} (never the `0`
 * sentinel) so transactions can be signed. RPC and explorer come from
 * `@settlekit/arc-chains` unless overridden.
 */
export function defineArcChain(opts: DefineArcChainOptions = {}) {
  const descriptor = getChain("Arc_Testnet");
  const chainId =
    opts.chainId ??
    (descriptor.chainId > 0 ? descriptor.chainId : ARC_TESTNET_CHAIN_ID);
  const rpcUrl = opts.rpcUrl ?? descriptor.rpcUrl;
  const explorerUrl = opts.explorerUrl ?? descriptor.explorerUrl;

  return defineChain({
    id: chainId,
    name: descriptor.displayName,
    // Arc uses USDC as the native gas token (18 decimals).
    nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
    },
    blockExplorers: {
      default: { name: "Arcscan", url: explorerUrl },
    },
    testnet: descriptor.testnet,
  });
}

/** Default Arc Testnet chain, built with arc-chains metadata + best-known id. */
export const arcTestnetChain = defineArcChain();
