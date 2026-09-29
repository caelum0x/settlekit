/**
 * Solana Pay references: a random 32-byte public key (with no known private
 * key) attached read-only to the payment transaction. Looking the reference up
 * with `getSignaturesForAddress` finds the payment without trusting the buyer
 * to report a signature, and binds the on-chain transfer to one checkout.
 */

import { getAddressDecoder } from "@solana/kit";
import { isSolanaAddress } from "./validate.js";

const REFERENCE_BYTES = 32;

/** Generate a fresh base58 reference key from 32 cryptographically random bytes. */
export function createReference(): string {
  const bytes = new Uint8Array(REFERENCE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return getAddressDecoder().decode(bytes);
}

/** True when `value` is a well-formed reference (a base58 32-byte key). */
export function isReference(value: string): boolean {
  return isSolanaAddress(value);
}
