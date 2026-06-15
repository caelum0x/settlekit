import { hashApiKey } from "./hash.js";
import type { ApiKeyStore } from "./store.js";
import type { VerifyApiKeyResult } from "./types.js";

/**
 * Verify a presented plaintext API key against the store.
 *
 * Hashes the plaintext, looks the record up by hash, and confirms the key is
 * active. A missing record or a non-active status both resolve to `valid:false`
 * without leaking which condition failed.
 */
export async function verifyApiKey(
  plaintext: string,
  store: ApiKeyStore,
): Promise<VerifyApiKeyResult> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    return { valid: false };
  }

  const apiKey = await store.findByHash(hashApiKey(plaintext));
  if (!apiKey || apiKey.status !== "active") {
    return { valid: false };
  }

  return { valid: true, apiKey };
}
