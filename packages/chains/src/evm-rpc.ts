/**
 * viem chain objects per registry spec, so receipts decode with the right
 * formatters (Tempo's 0x76 transaction type needs viem's `tempo` chain).
 * Robinhood Chain is not in viem yet and is defined here from the verified
 * registry values.
 */

import { createViemEvmRpc, type FullEvmRpc } from "@settlekit/arc";
import { defineChain, type Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  arcTestnet,
  base,
  baseSepolia,
  hyperEvm,
  hyperliquidEvmTestnet,
  mainnet,
  sepolia,
  tempo,
  tempoModerato,
} from "viem/chains";
import { getEvmChain, type EvmChainSpec } from "./registry.js";

function robinhoodChain(env: "mainnet" | "testnet"): Chain {
  const spec = getEvmChain("robinhood", env) as EvmChainSpec;
  return defineChain({
    id: spec.chainId,
    name: spec.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [spec.defaultRpcUrl] } },
    ...(env === "testnet" ? { testnet: true } : {}),
  });
}

const VIEM_CHAINS: ReadonlyMap<number, Chain> = new Map<number, Chain>(
  [
    mainnet,
    sepolia,
    base,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
    hyperEvm,
    hyperliquidEvmTestnet,
    tempo,
    tempoModerato,
    arcTestnet,
    robinhoodChain("mainnet"),
    robinhoodChain("testnet"),
  ].map((chain) => [chain.id, chain] as const),
);

/** The viem chain for a registry spec. */
export function viemChainFor(spec: EvmChainSpec): Chain {
  const chain = VIEM_CHAINS.get(spec.chainId);
  if (chain === undefined) throw new Error(`no viem chain definition for chain id ${spec.chainId}`);
  return chain;
}

/** A real viem-backed RPC for `spec` at `rpcUrl` (defaults to the spec's RPC). */
export function createChainRpc(spec: EvmChainSpec, rpcUrl: string = spec.defaultRpcUrl): FullEvmRpc {
  return createViemEvmRpc({ rpcUrl, chain: viemChainFor(spec) });
}
