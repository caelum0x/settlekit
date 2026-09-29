/**
 * Network-aware transaction-hash shape rules, re-exported from
 * @settlekit/chains so the checkout, API and worker agree byte for byte:
 *
 *   - EVM networks: 0x + 64 hex, case-insensitive, stored lowercase.
 *   - Solana: base58 64-byte signature, case-sensitive, stored verbatim.
 *   - Zcash: 64 hex (no 0x), stored lowercase.
 *
 * `isWellFormedTxHash` is kept as the checkout's historical name.
 */
export {
  isValidTxHash,
  isValidTxHash as isWellFormedTxHash,
  normalizeTxHash,
  parseTxHash,
  txHashFormatHint,
} from "@settlekit/chains";
