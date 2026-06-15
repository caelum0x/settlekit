import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { validationError } from "@settlekit/common";

/** Number of random bytes used for the per-password salt. */
const SALT_BYTES = 16;

/** Derived key length, in bytes. */
const KEY_LENGTH = 64;

/** Result of hashing a password: the derived key and the salt it used. */
export interface PasswordHash {
  /** Hex-encoded scrypt-derived key. */
  hash: string;
  /** Hex-encoded random salt. */
  salt: string;
}

/**
 * Hash a plaintext password with scrypt and a fresh random salt.
 *
 * scrypt is memory-hard and intentionally slow, which makes offline brute-force
 * attacks expensive. A new salt is generated per call so identical passwords
 * never produce identical hashes.
 */
export function hashPassword(password: string): PasswordHash {
  if (typeof password !== "string" || password.length === 0) {
    throw validationError("Password must be a non-empty string");
  }
  const salt = randomBytes(SALT_BYTES).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH);
  return { hash: derived.toString("hex"), salt };
}

/**
 * Verify a plaintext password against a stored scrypt `hash` and `salt`.
 *
 * Uses {@link timingSafeEqual} to compare the derived key against the stored
 * hash, avoiding timing side channels. Returns `false` (rather than throwing)
 * for any malformed or mismatched input.
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  if (
    typeof password !== "string" ||
    password.length === 0 ||
    typeof hash !== "string" ||
    hash.length === 0 ||
    typeof salt !== "string" ||
    salt.length === 0
  ) {
    return false;
  }

  let stored: Buffer;
  try {
    stored = Buffer.from(hash, "hex");
  } catch {
    return false;
  }
  if (stored.length === 0) {
    return false;
  }

  const derived = scryptSync(password, salt, stored.length);
  if (derived.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(derived, stored);
}
