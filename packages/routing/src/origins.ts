/**
 * Origin chains and tokens the checkout offers for "pay with any token".
 * Addresses verified against api.relay.link/chains on 2026-09-29. The
 * routing policy's allowlist (ROUTE_ORIGIN_ALLOWLIST) can narrow this list;
 * a token outside it is never quoted.
 */

import { RELAY_SOLANA_CHAIN_ID } from "./destination.js";
import type { RouteVm } from "./types.js";

export const EVM_NATIVE = "0x0000000000000000000000000000000000000000";
export const SOLANA_NATIVE = "11111111111111111111111111111111";

export interface OriginToken {
  symbol: string;
  address: string;
  decimals: number;
  native: boolean;
}

export interface OriginChain {
  chainId: number;
  name: string;
  vm: Extract<RouteVm, "evm" | "svm">;
  tokens: readonly OriginToken[];
}

const native = (symbol: string, decimals = 18, address = EVM_NATIVE): OriginToken => ({ symbol, address, decimals, native: true });
const erc20 = (symbol: string, address: string, decimals = 6): OriginToken => ({ symbol, address: address.toLowerCase(), decimals, native: false });

export const ORIGIN_CHAINS: readonly OriginChain[] = [
  {
    chainId: 1,
    name: "Ethereum",
    vm: "evm",
    tokens: [native("ETH"), erc20("USDC", "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), erc20("USDT", "0xdac17f958d2ee523a2206206994597c13d831ec7")],
  },
  {
    chainId: 8453,
    name: "Base",
    vm: "evm",
    tokens: [native("ETH"), erc20("USDC", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"), erc20("USDT", "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2")],
  },
  {
    chainId: 42161,
    name: "Arbitrum",
    vm: "evm",
    tokens: [native("ETH"), erc20("USDC", "0xaf88d065e77c8cc2239327c5edb3a432268e5831"), erc20("USDT", "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9")],
  },
  {
    chainId: 10,
    name: "OP Mainnet",
    vm: "evm",
    tokens: [native("ETH"), erc20("USDC", "0x0b2c639c533813f4aa9d7837caf62653d097ff85"), erc20("USDT", "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58")],
  },
  {
    chainId: 137,
    name: "Polygon",
    vm: "evm",
    tokens: [native("POL"), erc20("USDC", "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"), erc20("USDT", "0xc2132d05d31c914a87c6611c10748aeb04b58e8f")],
  },
  {
    chainId: 56,
    name: "BNB Chain",
    vm: "evm",
    tokens: [native("BNB"), erc20("USDT", "0x55d398326f99059ff775485246999027b3197955", 18), erc20("USDC", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", 18)],
  },
  {
    chainId: 999,
    name: "HyperEVM",
    vm: "evm",
    tokens: [native("HYPE"), erc20("USDC", "0xb88339cb7199b77e23db6e890353e22632ba630f")],
  },
  {
    chainId: 4663,
    name: "Robinhood Chain",
    vm: "evm",
    tokens: [native("ETH"), erc20("USDG", "0x5fc5360d0400a0fd4f2af552add042d716f1d168")],
  },
  {
    chainId: 4217,
    name: "Tempo",
    vm: "evm",
    tokens: [erc20("USDC.e", "0x20c000000000000000000000b9537d11c60e8b50"), erc20("pathUSD", "0x20c0000000000000000000000000000000000000")],
  },
  {
    chainId: RELAY_SOLANA_CHAIN_ID,
    name: "Solana",
    vm: "svm",
    tokens: [native("SOL", 9, SOLANA_NATIVE), { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, native: false }],
  },
];

/** Normalize a token id for comparison (EVM hex is case-insensitive, SPL mints are not). */
export function normalizeToken(token: string): string {
  return token.startsWith("0x") ? token.toLowerCase() : token;
}

/** The origin chain + token entry, or undefined when SettleKit does not offer it. */
export function findOrigin(chainId: number, token: string): { chain: OriginChain; token: OriginToken } | undefined {
  const chain = ORIGIN_CHAINS.find((entry) => entry.chainId === chainId);
  const match = chain?.tokens.find((entry) => entry.address === normalizeToken(token));
  return chain && match ? { chain, token: match } : undefined;
}
