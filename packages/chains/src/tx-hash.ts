/**
 * Network-aware transaction id rules (browser-safe).
 *
 *   - EVM and HyperCore: 0x + 64 hex, case-insensitive, stored lowercase.
 *   - Solana: base58 64-byte signature (64-88 chars), case-sensitive, verbatim.
 *   - Zcash: 64 hex without 0x, stored lowercase.
 */

import type { PaymentNetwork } from "@settlekit/common";
import { networkFamily } from "./networks.js";

const EVM_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ZCASH_TXID_RE = /^[0-9a-fA-F]{64}$/;

/** Whether `txHash` is well formed for `network`. */
export function isValidTxHash(network: PaymentNetwork, txHash: string): boolean {
  const value = txHash.trim();
  switch (networkFamily(network)) {
    case "solana":
      return SOLANA_SIGNATURE_RE.test(value);
    case "zcash":
      return ZCASH_TXID_RE.test(value);
    case "evm":
    case "hypercore":
      return EVM_TX_HASH_RE.test(value);
  }
}

/** Canonical storage form (does not validate; see {@link parseTxHash}). */
export function normalizeTxHash(network: PaymentNetwork, txHash: string): string {
  const value = txHash.trim();
  return networkFamily(network) === "solana" ? value : value.toLowerCase();
}

/** Canonical form of a well-formed hash, or null when malformed. */
export function parseTxHash(network: PaymentNetwork, txHash: string): string | null {
  return isValidTxHash(network, txHash) ? normalizeTxHash(network, txHash) : null;
}

/** Human description of the expected id format, for error messages. */
export function txHashFormatHint(network: PaymentNetwork): string {
  switch (networkFamily(network)) {
    case "solana":
      return "a Solana transaction signature (base58, about 88 characters)";
    case "zcash":
      return "a Zcash transaction id (64 hex characters)";
    case "evm":
      return "a transaction hash (0x followed by 64 hex characters)";
    case "hypercore":
      return "a HyperCore transaction hash (0x followed by 64 hex characters)";
  }
}
