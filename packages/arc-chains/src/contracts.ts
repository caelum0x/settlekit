/**
 * Known Arc Testnet contract addresses — ERC-8004 registries.
 *
 * These three addresses are MIRRORED VERBATIM from
 * packages/erc8004/src/addresses.ts, which is the canonical source. They are
 * re-declared here (rather than imported) so @settlekit/arc-chains stays
 * dependency-free and a leaf in the build graph. A test asserts the exact
 * values to catch drift; if erc8004 changes, update both and re-verify.
 *
 * Pure data only. No I/O. Addresses are never invented.
 */

import type { SupportedChain } from "./chains.js";

/** A set of ERC-8004 registry addresses for one network. */
export interface Erc8004Registries {
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
}

/**
 * Arc Testnet ERC-8004 registries.
 * Mirrored from packages/erc8004/src/addresses.ts (canonical source).
 */
export const ARC_TESTNET_REGISTRIES: Erc8004Registries = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

/**
 * Per-chain ERC-8004 registries, keyed by chain. Forward-compatible map; only
 * Arc Testnet is populated. Arc Mainnet is intentionally omitted — its
 * registry addresses are not yet in the Arc docs (do not invent).
 */
export const CONTRACTS: Partial<Record<SupportedChain, Erc8004Registries>> = {
  Arc_Testnet: ARC_TESTNET_REGISTRIES,
  // TODO: Arc_Mainnet ERC-8004 registries not yet in Arc docs — do not invent.
};
