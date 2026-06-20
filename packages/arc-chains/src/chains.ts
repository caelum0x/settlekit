/**
 * Arc / Circle chain descriptors — the single source of truth for chain
 * metadata (id, RPC, explorer) shared across SettleKit packages and apps.
 *
 * Pure data + pure functions only. No I/O.
 *
 * The {@link SupportedChain} union is re-declared here (rather than imported)
 * so this package stays dependency-free and a leaf in the build graph. It MUST
 * stay member-for-member identical to packages/app-kit/src/types.ts
 * (the canonical union for App Kit flows).
 *
 * Verified Arc Testnet endpoints are mirrored from
 * packages/erc8004/src/addresses.ts (the canonical source for Arc endpoints).
 * Non-Arc public chain ids and explorer hostnames are well-known public facts.
 * Public RPC URLs are environment-dependent; the defaults below are canonical
 * public endpoints — override per environment as needed.
 */

/**
 * Blockchains App Kit supports for SettleKit flows (Arc-centric).
 * Mirrors {@link SupportedChain} in packages/app-kit/src/types.ts.
 */
export type SupportedChain =
  | "Arc_Testnet"
  | "Arc_Mainnet"
  | "Ethereum_Sepolia"
  | "Ethereum"
  | "Base_Sepolia"
  | "Base"
  | "Arbitrum_Sepolia"
  | "Arbitrum";

/** Static metadata describing one chain. */
export interface ChainDescriptor {
  /** Stable key, matching the {@link SupportedChain} union. */
  key: SupportedChain;
  /** Human-readable name for UI surfaces. */
  displayName: string;
  /** EVM chain id (e.g. 1 for Ethereum mainnet). */
  chainId: number;
  /** JSON-RPC endpoint. Empty string when not yet published (see TODO). */
  rpcUrl: string;
  /** Block-explorer base URL. Empty string when not yet published (see TODO). */
  explorerUrl: string;
  /** True for testnets. */
  testnet: boolean;
}

/**
 * Arc Testnet endpoints — mirrored verbatim from
 * packages/erc8004/src/addresses.ts (canonical source).
 */
const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network/";
const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app";

/** Total record of every supported chain. */
export const CHAINS: Record<SupportedChain, ChainDescriptor> = {
  Arc_Testnet: {
    key: "Arc_Testnet",
    displayName: "Arc Testnet",
    // TODO: Arc Testnet EVM chainId not published in the Arc docs available in
    // this repo — do not invent. Left as the 0 sentinel until verified; the
    // verified rpcUrl/explorerUrl below are the source of truth for Arc Testnet.
    chainId: 0,
    rpcUrl: ARC_TESTNET_RPC_URL,
    explorerUrl: ARC_TESTNET_EXPLORER,
    testnet: true,
  },
  Arc_Mainnet: {
    key: "Arc_Mainnet",
    displayName: "Arc Mainnet",
    // TODO: Arc Mainnet chainId not yet in Arc docs.
    chainId: 0,
    // TODO: Arc mainnet RPC not yet in Arc docs — do not invent.
    rpcUrl: "",
    // TODO: Arc mainnet explorer not yet in Arc docs — do not invent.
    explorerUrl: "",
    testnet: false,
  },
  Ethereum: {
    key: "Ethereum",
    displayName: "Ethereum",
    chainId: 1,
    rpcUrl: "https://eth.llamarpc.com",
    explorerUrl: "https://etherscan.io",
    testnet: false,
  },
  Ethereum_Sepolia: {
    key: "Ethereum_Sepolia",
    displayName: "Ethereum Sepolia",
    chainId: 11155111,
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io",
    testnet: true,
  },
  Base: {
    key: "Base",
    displayName: "Base",
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    explorerUrl: "https://basescan.org",
    testnet: false,
  },
  Base_Sepolia: {
    key: "Base_Sepolia",
    displayName: "Base Sepolia",
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
    testnet: true,
  },
  Arbitrum: {
    key: "Arbitrum",
    displayName: "Arbitrum One",
    chainId: 42161,
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    testnet: false,
  },
  Arbitrum_Sepolia: {
    key: "Arbitrum_Sepolia",
    displayName: "Arbitrum Sepolia",
    chainId: 421614,
    rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerUrl: "https://sepolia.arbiscan.io",
    testnet: true,
  },
};

/** Runtime allow-list derived from {@link CHAINS}. */
export const SUPPORTED_CHAINS: readonly SupportedChain[] = Object.keys(
  CHAINS,
) as SupportedChain[];

/**
 * Look up a chain descriptor by key. {@link CHAINS} is a total
 * `Record<SupportedChain, ...>`, so a literal-union key never widens to
 * `undefined` under `noUncheckedIndexedAccess`.
 */
export function getChain(key: SupportedChain): ChainDescriptor {
  return CHAINS[key];
}

/** Build an explorer URL for a transaction hash on the given chain. */
export function explorerTxUrl(chain: ChainDescriptor, hash: string): string {
  return `${chain.explorerUrl}/tx/${hash}`;
}

/** Build an explorer URL for an address on the given chain. */
export function explorerAddressUrl(
  chain: ChainDescriptor,
  addr: string,
): string {
  return `${chain.explorerUrl}/address/${addr}`;
}
