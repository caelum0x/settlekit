/**
 * ERC-8004 on-chain registry addresses on Arc.
 *
 * ERC-8004 gives autonomous agents an on-chain identity (an ERC-721 minted by
 * the IdentityRegistry), reputation (attestations recorded by external
 * validators in the ReputationRegistry), and a request/response validation flow
 * (the ValidationRegistry). These are the deployed Arc Testnet addresses from
 * the Arc docs — verify against https://docs.arc.io before mainnet use.
 */

/** A set of ERC-8004 registry addresses for one network. */
export interface Erc8004Registries {
  identityRegistry: string;
  reputationRegistry: string;
  validationRegistry: string;
}

/** Arc Testnet ERC-8004 registries. */
export const ARC_TESTNET_REGISTRIES: Erc8004Registries = {
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  validationRegistry: "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
};

/** Arc Testnet JSON-RPC endpoint. */
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network/";

/** Arc Testnet block explorer base. */
export const ARC_TESTNET_EXPLORER = "https://testnet.arcscan.app";

/** Build an explorer URL for a transaction hash. */
export function explorerTxUrl(txHash: string, base = ARC_TESTNET_EXPLORER): string {
  return `${base}/tx/${txHash}`;
}

/** Build an explorer URL for an address. */
export function explorerAddressUrl(address: string, base = ARC_TESTNET_EXPLORER): string {
  return `${base}/address/${address}`;
}
