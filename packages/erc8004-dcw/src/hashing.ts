/**
 * Hashing helpers for the DCW ERC-8004 port.
 *
 * The ReputationRegistry's `feedbackHash` and the ValidationRegistry's
 * `requestHash` are `keccak256(toHex(tag|subject))`. This package takes NO crypto
 * dependency and NEVER hand-rolls a hash: the real `keccak256` is INJECTED by the
 * caller (the consumer already has `viem.keccak256`). These helpers are pure
 * glue that apply `toHex` then the injected `keccak256`, so the on-chain value is
 * reproduced exactly when the injected functions match the contract's encoding.
 *
 * `toHex` (UTF-8 string -> 0x-prefixed hex) is a trivial, NON-cryptographic byte
 * encoding, so a default is provided. It must match how the contract encodes the
 * pre-image (UTF-8 bytes); override it if the deployed contract differs.
 */

/** A keccak256 function the caller injects (e.g. `viem.keccak256`). */
export type Keccak256 = (hex: string) => string;

/** Convert a string to its 0x-prefixed UTF-8 hex (non-cryptographic encoding). */
export type ToHex = (value: string) => string;

/**
 * Default UTF-8 -> 0x-hex encoder. Pure, dependency-free, NOT crypto: it just
 * renders the UTF-8 bytes of `value` as lowercase hex. Empty strings map to
 * `0x`.
 */
export function utf8ToHex(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = "0x";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * `feedbackHash = keccak256(toHex(tag))`. The injected `keccak256` does all
 * hashing; this helper only sequences `toHex` then `keccak256`.
 */
export function feedbackHash(tag: string, keccak256: Keccak256, toHex: ToHex = utf8ToHex): string {
  return keccak256(toHex(tag));
}

/**
 * `requestHash = keccak256(toHex(subject))`. The injected `keccak256` does all
 * hashing; this helper only sequences `toHex` then `keccak256`.
 */
export function requestHash(
  subject: string,
  keccak256: Keccak256,
  toHex: ToHex = utf8ToHex,
): string {
  return keccak256(toHex(subject));
}
