/**
 * Map an `@settlekit/arc-chains` {@link ChainDescriptor} to a viem `Chain` via
 * `defineChain`. Pure — no transport is constructed here.
 *
 * Arc is a USDC-gas chain; viem still requires a `nativeCurrency`, so the
 * default is USDC (6 decimals). It is configurable because it only affects fee
 * *display* in `estimateSend`, never the transfer calldata.
 *
 * HARD RULE: never invent endpoints. arc-chains leaves unpublished values as the
 * `0` chainId sentinel or `""` urls; this helper throws a clear error rather
 * than fabricating. We deliberately do NOT import `arcTestnet` from
 * `viem/chains` (it may not exist) — the chain is defined from arc-chains data.
 */

import { defineChain } from "viem";
import type { Chain } from "viem";
import type { ChainDescriptor } from "@settlekit/arc-chains";
import { SettleKitError } from "@settlekit/common";

/** Native-currency metadata for the defined chain. Defaults to USDC (Arc gas). */
export interface NativeCurrencyConfig {
  name: string;
  symbol: string;
  decimals: number;
}

const DEFAULT_NATIVE_CURRENCY: NativeCurrencyConfig = {
  name: "USDC",
  symbol: "USDC",
  decimals: 6,
};

/**
 * Build a viem `Chain` from an arc-chains descriptor.
 *
 * @throws {SettleKitError} `validation_error` when the descriptor has the `0`
 *   chainId sentinel or an empty rpc/explorer url (i.e. not yet published).
 */
export function toViemChain(
  descriptor: ChainDescriptor,
  nativeCurrency: NativeCurrencyConfig = DEFAULT_NATIVE_CURRENCY,
): Chain {
  if (descriptor.chainId === 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: `chainId for ${descriptor.key} is not published (0 sentinel) — supply config.chainId or wait for @settlekit/arc-chains to publish it; never invented`,
    });
  }
  if (descriptor.rpcUrl === "") {
    throw new SettleKitError({
      code: "validation_error",
      message: `rpcUrl for ${descriptor.key} is not published — supply config.rpcUrl; never invented`,
    });
  }
  if (descriptor.explorerUrl === "") {
    throw new SettleKitError({
      code: "validation_error",
      message: `explorerUrl for ${descriptor.key} is not published — supply config.explorerUrl; never invented`,
    });
  }

  return defineChain({
    id: descriptor.chainId,
    name: descriptor.displayName,
    nativeCurrency: {
      name: nativeCurrency.name,
      symbol: nativeCurrency.symbol,
      decimals: nativeCurrency.decimals,
    },
    rpcUrls: {
      default: { http: [descriptor.rpcUrl] },
    },
    blockExplorers: {
      default: {
        name: `${descriptor.displayName} Explorer`,
        url: descriptor.explorerUrl,
      },
    },
    testnet: descriptor.testnet,
  });
}
