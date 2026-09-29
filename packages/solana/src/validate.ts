/**
 * Base58 validators for Solana addresses and transaction signatures. Both go
 * through `@solana/kit`'s decoders, so a value is only accepted when it
 * decodes to exactly 32 (address) or 64 (signature) bytes. Kit's checks throw
 * on characters outside the base58 alphabet, so a regex guards them first.
 */

import { isAddress, isSignature } from "@solana/kit";

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

function safely(check: (value: string) => boolean, value: string): boolean {
  if (!BASE58_RE.test(value)) return false;
  try {
    return check(value);
  } catch {
    return false;
  }
}

/** True when `value` is a base58-encoded 32-byte public key. */
export function isSolanaAddress(value: string): boolean {
  return safely(isAddress, value);
}

/** True when `value` is a base58-encoded 64-byte transaction signature. */
export function isSolanaSignature(value: string): boolean {
  return safely(isSignature, value);
}
