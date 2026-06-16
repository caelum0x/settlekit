/**
 * Arc network chain definitions and on-chain contract addresses.
 *
 * Arc is Circle's stablecoin-native L1: **USDC is the native gas token**, with
 * an optional 6-decimal ERC-20 interface used for transfers and settlement
 * verification. Addresses below are the published Arc **testnet** values
 * (chain id 5042002); mainnet addresses are not yet published.
 *
 * Sources: Arc docs (contract addresses, chain settings). Verify against
 * https://docs.arc.io/arc/references/contract-addresses before mainnet use.
 */

import type { ArcAddress } from "./index.js";

/** Stablecoin assets settleable on Arc. All expose a 6-decimal ERC-20 interface. */
export type ArcAsset = "USDC" | "EURC" | "USYC";

/** A token's on-chain identity on an Arc chain. */
export interface ArcTokenInfo {
  symbol: ArcAsset;
  /** ERC-20 contract address (USDC also has a native balance at this address). */
  address: ArcAddress;
  /** Decimals of the ERC-20 interface (6 for every Arc stablecoin). */
  decimals: number;
  description: string;
}

/** Protocol + system contract addresses used by the higher-level workstreams. */
export interface ArcContracts {
  /** CCTP v2 burn entrypoint for cross-chain USDC (TokenMessengerV2). */
  cctpTokenMessengerV2: ArcAddress;
  /** CCTP v2 message receiver/mint entrypoint (MessageTransmitterV2). */
  cctpMessageTransmitterV2: ArcAddress;
  /** Gateway (Unified Balance) deposit wallet. */
  gatewayWallet: ArcAddress;
  /** Gateway (Unified Balance) minter. */
  gatewayMinter: ArcAddress;
  /** StableFX escrow for on-chain stablecoin FX. */
  fxEscrow: ArcAddress;
  /** Canonical Permit2. */
  permit2: ArcAddress;
  /** Canonical Multicall3. */
  multicall3: ArcAddress;
  /** Deterministic CREATE2 factory. */
  create2Factory: ArcAddress;
}

/** A fully described Arc chain. */
export interface ArcChain {
  name: string;
  /** EVM chain id. */
  chainId: number;
  network: "testnet" | "mainnet";
  /** Default public JSON-RPC endpoint (override via config/env in production). */
  rpcUrl: string;
  explorerUrl: string;
  faucetUrl?: string;
  /** CCTP domain id for this chain (used when bridging USDC in/out). */
  cctpDomain: number;
  /** The native gas asset (always USDC on Arc). */
  nativeGasAsset: ArcAsset;
  tokens: Record<ArcAsset, ArcTokenInfo>;
  contracts: ArcContracts;
}

/**
 * Arc testnet. USDC is the native gas token at `0x3600…0000`; the same address
 * exposes the 6-decimal ERC-20 interface used for transfer/settlement logs.
 */
export const ARC_TESTNET: ArcChain = {
  name: "Arc Testnet",
  chainId: 5_042_002,
  network: "testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerUrl: "https://testnet.arcscan.app",
  faucetUrl: "https://faucet.circle.com",
  cctpDomain: 26,
  nativeGasAsset: "USDC",
  tokens: {
    USDC: {
      symbol: "USDC",
      address: "0x3600000000000000000000000000000000000000",
      decimals: 6,
      description: "Native gas token; 6-decimal ERC-20 interface.",
    },
    EURC: {
      symbol: "EURC",
      address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      decimals: 6,
      description: "Euro-backed stablecoin.",
    },
    USYC: {
      symbol: "USYC",
      address: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C",
      decimals: 6,
      description: "Tokenized yield-bearing US Treasury product.",
    },
  },
  contracts: {
    cctpTokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
    cctpMessageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    gatewayMinter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
    fxEscrow: "0x867650F5eAe8df91445971f14d89fd84F0C9a9f8",
    permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
    create2Factory: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  },
};

/** All known Arc chains, keyed by chain id. */
export const ARC_CHAINS: Record<number, ArcChain> = {
  [ARC_TESTNET.chainId]: ARC_TESTNET,
};

/** Look up a chain by id, or `undefined` if unknown. */
export function getArcChain(chainId: number): ArcChain | undefined {
  return ARC_CHAINS[chainId];
}

/** Resolve a token's on-chain info on a chain, or `undefined` if unsupported. */
export function getArcToken(chain: ArcChain, asset: ArcAsset): ArcTokenInfo | undefined {
  return chain.tokens[asset];
}

/** True when `value` names a stablecoin Arc supports. */
export function isArcAsset(value: string): value is ArcAsset {
  return value === "USDC" || value === "EURC" || value === "USYC";
}
