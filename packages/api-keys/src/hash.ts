import { createHash } from "node:crypto";

/**
 * Deterministically hash a plaintext API key with SHA-256.
 *
 * Only the hash is ever stored; lookups re-hash the presented plaintext and
 * compare against the stored value. Encoded as lowercase hex so it can be used
 * as a stable store key.
 */
export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
