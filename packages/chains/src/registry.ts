/**
 * EVM chains SettleKit accepts stablecoin payments on.
 *
 * Every id, RPC, explorer and token address below was verified on
 * 2026-09-29 with live `eth_chainId` / `eth_call` plus the issuers' docs
 * (see docs/colosseum/MULTICHAIN-PLAN.md). All tokens use 6 decimals and
 * emit the standard ERC-20 `Transfer` event. Do not edit an address without
 * re-verifying it: many look-alike tokens exist on these chains.
 */

import { ARC_TESTNET } from "@settlekit/arc";

export type EvmChainKey = "ethereum" | "base" | "arbitrum" | "robinhood" | "hyperevm" | "tempo" | "arc";
export type ChainEnv = "mainnet" | "testnet";
export type Hex = `0x${string}`;

export const EVM_CHAIN_KEYS: readonly EvmChainKey[] = [
  "ethereum",
  "base",
  "arbitrum",
  "robinhood",
  "hyperevm",
  "tempo",
  "arc",
];

export interface EvmTokenSpec {
  symbol: string;
  address: Hex;
  decimals: 6;
}

export interface EvmChainSpec {
  key: EvmChainKey;
  env: ChainEnv;
  chainId: number;
  caip2: `eip155:${number}`;
  name: string;
  defaultRpcUrl: string;
  /** Explorer page for a tx, or null when the network has no public explorer. */
  explorerTx(hash: string): string | null;
  token: EvmTokenSpec;
  minConfirmations: number;
  /** Honest disclosure shown next to the chain. */
  label?: "testnet" | "bridged";
}

interface SpecInput {
  key: EvmChainKey;
  env: ChainEnv;
  chainId: number;
  name: string;
  rpc: string;
  explorer: string | null;
  symbol: string;
  token: Hex;
  minConfirmations: number;
  label?: "testnet" | "bridged";
}

function spec(input: SpecInput): EvmChainSpec {
  const explorer = input.explorer;
  return {
    key: input.key,
    env: input.env,
    chainId: input.chainId,
    caip2: `eip155:${input.chainId}`,
    name: input.name,
    defaultRpcUrl: input.rpc,
    explorerTx: (hash) => (explorer === null ? null : `${explorer}${hash}`),
    token: { symbol: input.symbol, address: input.token, decimals: 6 },
    minConfirmations: input.minConfirmations,
    ...(input.label ? { label: input.label } : {}),
  };
}

const MAINNET: Readonly<Partial<Record<EvmChainKey, EvmChainSpec>>> = {
  ethereum: spec({
    key: "ethereum", env: "mainnet", chainId: 1, name: "Ethereum",
    rpc: "https://ethereum-rpc.publicnode.com", explorer: "https://etherscan.io/tx/",
    symbol: "USDC", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", minConfirmations: 12,
  }),
  base: spec({
    key: "base", env: "mainnet", chainId: 8453, name: "Base",
    rpc: "https://mainnet.base.org", explorer: "https://basescan.org/tx/",
    symbol: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", minConfirmations: 3,
  }),
  arbitrum: spec({
    key: "arbitrum", env: "mainnet", chainId: 42161, name: "Arbitrum One",
    rpc: "https://arb1.arbitrum.io/rpc", explorer: "https://arbiscan.io/tx/",
    symbol: "USDC", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", minConfirmations: 3,
  }),
  robinhood: spec({
    key: "robinhood", env: "mainnet", chainId: 4663, name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com/tx/",
    symbol: "USDG", token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", minConfirmations: 3,
  }),
  hyperevm: spec({
    key: "hyperevm", env: "mainnet", chainId: 999, name: "HyperEVM",
    rpc: "https://rpc.hyperliquid.xyz/evm", explorer: "https://hyperevmscan.io/tx/",
    symbol: "USDC", token: "0xb88339CB7199b77E23DB6E890353E22632Ba630f", minConfirmations: 1,
  }),
  tempo: spec({
    key: "tempo", env: "mainnet", chainId: 4217, name: "Tempo",
    rpc: "https://rpc.tempo.xyz", explorer: "https://explore.tempo.xyz/tx/",
    symbol: "USDC.e", token: "0x20c000000000000000000000b9537d11c60e8b50", minConfirmations: 1,
    label: "bridged",
  }),
};

const TESTNET: Readonly<Partial<Record<EvmChainKey, EvmChainSpec>>> = {
  ethereum: spec({
    key: "ethereum", env: "testnet", chainId: 11155111, name: "Ethereum Sepolia",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io/tx/",
    symbol: "USDC", token: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", minConfirmations: 12, label: "testnet",
  }),
  base: spec({
    key: "base", env: "testnet", chainId: 84532, name: "Base Sepolia",
    rpc: "https://sepolia.base.org", explorer: "https://sepolia.basescan.org/tx/",
    symbol: "USDC", token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", minConfirmations: 3, label: "testnet",
  }),
  arbitrum: spec({
    key: "arbitrum", env: "testnet", chainId: 421614, name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc", explorer: "https://sepolia.arbiscan.io/tx/",
    symbol: "USDC", token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", minConfirmations: 3, label: "testnet",
  }),
  robinhood: spec({
    key: "robinhood", env: "testnet", chainId: 46630, name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com/tx/",
    symbol: "USDC", token: "0x5B6C7cAF7F99f99154fD8375ec935Fcf03F326f5", minConfirmations: 3, label: "testnet",
  }),
  hyperevm: spec({
    key: "hyperevm", env: "testnet", chainId: 998, name: "HyperEVM Testnet",
    rpc: "https://rpc.hyperliquid-testnet.xyz/evm", explorer: null,
    symbol: "USDC", token: "0x2B3370eE501B4a559b57D449569354196457D8Ab", minConfirmations: 1, label: "testnet",
  }),
  tempo: spec({
    key: "tempo", env: "testnet", chainId: 42431, name: "Tempo Moderato",
    rpc: "https://rpc.moderato.tempo.xyz", explorer: "https://explore.testnet.tempo.xyz/tx/",
    symbol: "pathUSD", token: "0x20c0000000000000000000000000000000000000", minConfirmations: 1, label: "testnet",
  }),
  arc: spec({
    key: "arc", env: "testnet", chainId: ARC_TESTNET.chainId, name: ARC_TESTNET.name,
    rpc: ARC_TESTNET.rpcUrl, explorer: `${ARC_TESTNET.explorerUrl}/tx/`,
    symbol: "USDC", token: ARC_TESTNET.tokens.USDC.address, minConfirmations: 3, label: "testnet",
  }),
};

/** The registry: chain specs per environment (Arc has no mainnet yet). */
export const EVM_CHAINS: Readonly<Record<ChainEnv, Readonly<Partial<Record<EvmChainKey, EvmChainSpec>>>>> = {
  mainnet: MAINNET,
  testnet: TESTNET,
};

/** True when `value` names an EVM chain key. */
export function isEvmChainKey(value: string): value is EvmChainKey {
  return (EVM_CHAIN_KEYS as readonly string[]).includes(value);
}

/** The spec for `key` on `env`, or undefined when that pairing does not exist. */
export function getEvmChain(key: EvmChainKey, env: ChainEnv): EvmChainSpec | undefined {
  return EVM_CHAINS[env][key];
}

/** Look a spec up by numeric chain id across both environments. */
export function findEvmChainById(chainId: number): EvmChainSpec | undefined {
  for (const env of ["mainnet", "testnet"] as const) {
    const match = Object.values(EVM_CHAINS[env]).find((entry) => entry?.chainId === chainId);
    if (match) return match;
  }
  return undefined;
}
