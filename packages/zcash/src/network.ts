/**
 * Zcash network parameters for transparent (t-address) settlement.
 *
 * Prefixes are the two-byte base58check version prefixes from the Zcash
 * protocol specification §5.6.1.1: mainnet P2PKH 0x1CB8 ("t1"), P2SH 0x1CBD
 * ("t3"); testnet P2PKH 0x1D25 ("tm"), P2SH 0x1CBA ("t2").
 */

export type ZcashNetwork = "mainnet" | "testnet";

export type TransparentKind = "p2pkh" | "p2sh";

export interface ZcashNetworkSpec {
  network: ZcashNetwork;
  /** SettleKit-internal CAIP-2-style id (Zcash has no registered CAIP-2 namespace). */
  caip2: `zcash:${ZcashNetwork}`;
  prefixes: Readonly<Record<TransparentKind, readonly [number, number]>>;
  /** Public explorer tx URL, or null when no trusted public explorer exists. */
  explorerTx(txid: string): string | null;
}

export const ZCASH_DECIMALS = 8;
export const ZATOSHIS_PER_ZEC = 100_000_000n;
export const ZCASH_ASSET = "ZEC" as const;

export const ZCASH_NETWORKS: Readonly<Record<ZcashNetwork, ZcashNetworkSpec>> = {
  mainnet: {
    network: "mainnet",
    caip2: "zcash:mainnet",
    prefixes: { p2pkh: [0x1c, 0xb8], p2sh: [0x1c, 0xbd] },
    explorerTx: (txid) => `https://blockchair.com/zcash/transaction/${txid}`,
  },
  testnet: {
    network: "testnet",
    caip2: "zcash:testnet",
    prefixes: { p2pkh: [0x1d, 0x25], p2sh: [0x1c, 0xba] },
    explorerTx: () => null,
  },
};

/** Parse a network name, or undefined when unknown. */
export function parseZcashNetwork(value: string): ZcashNetwork | undefined {
  const normalized = value.trim().toLowerCase();
  return normalized === "mainnet" || normalized === "testnet" ? normalized : undefined;
}

/** Explorer link for `txid` on `network` (null when none exists). */
export function zcashExplorerTxUrl(network: ZcashNetwork, txid: string): string | null {
  return ZCASH_NETWORKS[network].explorerTx(txid);
}
