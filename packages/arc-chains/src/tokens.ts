/**
 * Token metadata for Arc / Circle flows — symbol-level decimals plus optional
 * per-chain placement. The single source of truth for token constants shared
 * across SettleKit packages and apps.
 *
 * Pure data only. No I/O.
 *
 * HARD RULE: on-chain token addresses are NEVER invented. Every `address` is
 * left `undefined` with a `// TODO` until a value appears in the Arc docs.
 *
 * The {@link SupportedToken} union is re-declared here (rather than imported)
 * so this package stays dependency-free. It MUST stay member-for-member
 * identical to packages/app-kit/src/types.ts (the canonical union).
 */

import type { SupportedChain } from "./chains.js";

/**
 * Tokens App Kit can transfer or swap.
 * Mirrors {@link SupportedToken} in packages/app-kit/src/types.ts.
 */
export type SupportedToken =
  | "USDC"
  | "EURC"
  | "USDT"
  | "USDe"
  | "DAI"
  | "PYUSD"
  | "cirBTC";

/** Runtime allow-list mirroring {@link SupportedToken}. */
export const SUPPORTED_TOKENS: readonly SupportedToken[] = [
  "USDC",
  "EURC",
  "USDT",
  "USDe",
  "DAI",
  "PYUSD",
  "cirBTC",
];

/** Metadata for one token. */
export interface TokenMetadata {
  /** Token symbol. */
  symbol: SupportedToken;
  /** ERC-20 decimals. */
  decimals: number;
  /**
   * On-chain contract address. Optional and left `undefined` until published
   * in the Arc docs — addresses are never invented.
   */
  address?: string;
}

/**
 * Symbol-level token metadata. Decimals use well-established standards:
 * USDC/EURC/USDT/PYUSD = 6, DAI/USDe = 18, cirBTC = 8 (BTC-pegged).
 * Addresses are intentionally omitted (per-chain; see {@link CHAIN_TOKENS}).
 */
export const TOKENS: Record<SupportedToken, TokenMetadata> = {
  // Decimals = 6 per the Arc/Circle stablecoin spec.
  USDC: { symbol: "USDC", decimals: 6 },
  EURC: { symbol: "EURC", decimals: 6 },
  // USDT uses 6 decimals on EVM chains (standard).
  USDT: { symbol: "USDT", decimals: 6 },
  // USDe (Ethena) uses 18 decimals (standard).
  USDe: { symbol: "USDe", decimals: 18 },
  // DAI uses 18 decimals (standard).
  DAI: { symbol: "DAI", decimals: 18 },
  // PYUSD uses 6 decimals (standard).
  PYUSD: { symbol: "PYUSD", decimals: 6 },
  // cirBTC is BTC-pegged; 8 decimals (BTC convention).
  // TODO: confirm cirBTC decimals against Arc docs.
  cirBTC: { symbol: "cirBTC", decimals: 8 },
};

/**
 * Per-chain token placement. Populated only where token presence is known;
 * decimals carry over from {@link TOKENS} and addresses stay `undefined` until
 * the Arc docs publish them (never invented).
 *
 * USDC and EURC are Circle's native stablecoins on Arc, hence listed on
 * Arc Testnet. Addresses are TODO.
 */
export const CHAIN_TOKENS: Partial<
  Record<SupportedChain, Partial<Record<SupportedToken, TokenMetadata>>>
> = {
  Arc_Testnet: {
    // TODO: USDC address on Arc Testnet not in Arc docs — do not invent.
    USDC: { symbol: "USDC", decimals: 6 },
    // TODO: EURC address on Arc Testnet not in Arc docs — do not invent.
    EURC: { symbol: "EURC", decimals: 6 },
  },
};

/**
 * Look up symbol-level token metadata. {@link TOKENS} is a total
 * `Record<SupportedToken, ...>`, so a literal-union key never widens to
 * `undefined` under `noUncheckedIndexedAccess`.
 */
export function getToken(symbol: SupportedToken): TokenMetadata {
  return TOKENS[symbol];
}
