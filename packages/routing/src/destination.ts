/**
 * PaymentNetwork → route destination (provider chain id + the stablecoin the
 * session's verifier accepts). Any-token routing is MAINNET ONLY (Relay and
 * LI.FI route real liquidity), and a route must deliver EXACTLY the token the
 * destination verifier checks — otherwise a "successful" route could never
 * settle. Values verified against api.relay.link/chains and li.quest/v1/chains
 * + /tokens on 2026-09-29.
 */

import { getEvmChain, isEvmNetwork, type ChainEnv } from "@settlekit/chains";
import type { PaymentNetwork } from "@settlekit/common";
import type { RouteDestination } from "./types.js";

export const RELAY_SOLANA_CHAIN_ID = 792703809;
export const RELAY_HYPERCORE_CHAIN_ID = 1337;
export const LIFI_SOLANA_CHAIN_ID = 1151111081099710;

export const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Relay's id for HyperCore perps USDC (8 decimals); `usdSend` credits land here. */
export const HYPERCORE_PERPS_USDC = "0x00000000000000000000000000000000";
export const HYPERCORE_PERPS_USDC_DECIMALS = 8;

/** Tempo stablecoins Relay can deliver; the destination follows the verifier's token. */
export const TEMPO_ROUTE_TOKENS: Readonly<Record<string, string>> = {
  "0x20c000000000000000000000b9537d11c60e8b50": "USDC.e",
  "0x20c0000000000000000000000000000000000000": "pathUSD",
};

export interface DestinationOptions {
  env: ChainEnv;
  /** The token the destination verifier checks (EVM `<KEY>_TOKEN_ADDRESS` runtime value). */
  tokenAddress?: string;
}

export type DestinationResult = { ok: true; destination: RouteDestination } | { ok: false; reason: string };

function evmDestination(network: PaymentNetwork, options: DestinationOptions): DestinationResult {
  if (!isEvmNetwork(network)) return { ok: false, reason: `${network} is not an EVM network` };
  const spec = getEvmChain(network, "mainnet");
  if (spec === undefined) return { ok: false, reason: `${network} has no mainnet; any-token routing needs one` };
  const token = (options.tokenAddress ?? spec.token.address).toLowerCase();
  let symbol = spec.token.symbol;
  if (network === "tempo") {
    const known = TEMPO_ROUTE_TOKENS[token];
    if (known === undefined) return { ok: false, reason: `Tempo token ${token} is not routable` };
    symbol = known;
  } else if (token !== spec.token.address.toLowerCase()) {
    return { ok: false, reason: `${network} verifies ${token}, which is not the routable ${spec.token.symbol}` };
  }
  return {
    ok: true,
    destination: {
      network,
      chainId: spec.chainId,
      token,
      symbol,
      decimals: spec.token.decimals,
      vm: "evm",
      lifi: { chainId: spec.chainId, token },
    },
  };
}

/** The route destination for `network`, or why routing to it is impossible. */
export function routeDestinationFor(network: PaymentNetwork, options: DestinationOptions): DestinationResult {
  if (options.env !== "mainnet") return { ok: false, reason: "any-token routing is available on mainnet only" };
  switch (network) {
    case "solana":
      return {
        ok: true,
        destination: {
          network,
          chainId: RELAY_SOLANA_CHAIN_ID,
          token: SOLANA_USDC_MINT,
          symbol: "USDC",
          decimals: 6,
          vm: "svm",
          lifi: { chainId: LIFI_SOLANA_CHAIN_ID, token: SOLANA_USDC_MINT },
        },
      };
    case "hypercore":
      // LI.FI lists two "USDC" tokens on 1337 (perps vs spot, 6 vs 8 decimals):
      // too ambiguous to settle a verified usdSend-style credit, so Relay only.
      return {
        ok: true,
        destination: {
          network,
          chainId: RELAY_HYPERCORE_CHAIN_ID,
          token: HYPERCORE_PERPS_USDC,
          symbol: "USDC",
          decimals: HYPERCORE_PERPS_USDC_DECIMALS,
          vm: "hypercore",
          lifi: null,
        },
      };
    case "ethereum":
    case "base":
    case "arbitrum":
    case "robinhood":
    case "hyperevm":
    case "tempo":
      return evmDestination(network, options);
    case "arc":
      return { ok: false, reason: "Arc has no mainnet route providers yet" };
    case "zcash":
      return { ok: false, reason: "route providers do not deliver ZEC" };
    default: {
      const unreachable: never = network;
      return { ok: false, reason: `unknown network ${String(unreachable)}` };
    }
  }
}

/** Session 6-decimal base units → destination-token base units. */
export function toDestinationUnits(amountBase: bigint, decimals: number): bigint {
  if (decimals === 6) return amountBase;
  if (decimals > 6) return amountBase * 10n ** BigInt(decimals - 6);
  // Fewer decimals: round UP so the merchant is never underpaid.
  const divisor = 10n ** BigInt(6 - decimals);
  return (amountBase + divisor - 1n) / divisor;
}
