import { createHash } from "node:crypto";

/**
 * Deterministically hash an opaque token (session token, magic-link token)
 * with SHA-256, mirroring the api-keys hashing style.
 *
 * Only the hash is ever persisted; verification re-hashes the presented
 * plaintext and looks it up. Encoded as lowercase hex so it is a stable key.
 */
export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}
