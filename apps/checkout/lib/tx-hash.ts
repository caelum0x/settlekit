/**
 * Network-aware transaction-hash shape rules (client-safe: no chain SDKs).
 *
 *   - EVM networks (arc, base, ethereum): 0x + 64 hex, case-insensitive and
 *     stored lowercase (matches the API's normalization).
 *   - Solana: a base58 64-byte signature (87-88 chars in practice), case-
 *     sensitive and stored verbatim. The server re-checks with @solana/kit.
 */
import type { PaymentNetwork } from "@settlekit/common";

const EVM_TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

/** Whether `txHash` is well formed for `network`. */
export function isWellFormedTxHash(network: PaymentNetwork, txHash: string): boolean {
  const value = txHash.trim();
  return network === "solana" ? SOLANA_SIGNATURE_RE.test(value) : EVM_TX_HASH_RE.test(value);
}

/** Canonical storage form of `txHash` on `network`. */
export function normalizeTxHash(network: PaymentNetwork, txHash: string): string {
  const value = txHash.trim();
  return network === "solana" ? value : value.toLowerCase();
}

/** Human description of the expected hash format, for error messages. */
export function txHashFormatHint(network: PaymentNetwork): string {
  return network === "solana"
    ? "a Solana transaction signature (base58, about 88 characters)"
    : "a transaction hash (0x followed by 64 hex characters)";
}
