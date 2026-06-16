/**
 * CCTP domain id map and lookups.
 *
 * Circle's Cross-Chain Transfer Protocol assigns every supported blockchain a
 * numeric "domain" id, independent of its EVM chain id. Burns name a
 * `destinationDomain`; mints are submitted on the chain owning that domain.
 *
 * Values mirror Circle's published CCTP V2 domain list (EVM chains) plus the
 * non-EVM domains used by CCTP. Arc testnet's domain (26) matches
 * `ARC_TESTNET.cctpDomain` in `@settlekit/arc`.
 *
 * Source: https://developers.circle.com/cctp/evm-smart-contracts
 */

/** A CCTP-supported blockchain, keyed by a stable string name. */
export type CctpChainName =
  | "ethereum"
  | "avalanche"
  | "optimism"
  | "arbitrum"
  | "noble"
  | "solana"
  | "base"
  | "polygon"
  | "unichain"
  | "linea"
  | "codex"
  | "sonic"
  | "worldchain"
  | "monad"
  | "sei"
  | "xdc"
  | "hyperevm"
  | "ink"
  | "plume"
  | "arc"
  | "edge"
  | "injective"
  | "morph"
  | "pharos";

/** Canonical CCTP domain id for each supported chain. */
export const CCTP_DOMAINS: Record<CctpChainName, number> = {
  ethereum: 0,
  avalanche: 1,
  optimism: 2,
  arbitrum: 3,
  noble: 4,
  solana: 5,
  base: 6,
  polygon: 7,
  unichain: 10,
  linea: 11,
  codex: 12,
  sonic: 13,
  worldchain: 14,
  monad: 15,
  sei: 16,
  xdc: 18,
  hyperevm: 19,
  ink: 21,
  plume: 22,
  arc: 26,
  edge: 28,
  injective: 29,
  morph: 30,
  pharos: 31,
};

/** Reverse map from domain id to chain name, derived once from {@link CCTP_DOMAINS}. */
const DOMAIN_TO_NAME: ReadonlyMap<number, CctpChainName> = new Map(
  (Object.entries(CCTP_DOMAINS) as Array<[CctpChainName, number]>).map(
    ([name, domain]) => [domain, name],
  ),
);

/** Resolve a chain name to its CCTP domain id, or `undefined` if unknown. */
export function getCctpDomain(name: CctpChainName): number {
  return CCTP_DOMAINS[name];
}

/** Resolve a CCTP domain id to its chain name, or `undefined` if unknown. */
export function getCctpChainName(domain: number): CctpChainName | undefined {
  return DOMAIN_TO_NAME.get(domain);
}

/** True when `domain` is a known CCTP domain id. */
export function isKnownCctpDomain(domain: number): boolean {
  return DOMAIN_TO_NAME.has(domain);
}
