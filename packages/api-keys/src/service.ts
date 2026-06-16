import type { ApiKey } from "@settlekit/common";
import { notFound } from "@settlekit/common";
import { issueApiKey } from "./issue.js";
import { recordUsage, revoke } from "./lifecycle.js";
import { hasAllScopes, hasScope } from "./scopes.js";
import { hashApiKey } from "./hash.js";
import type { ApiKeyStore } from "./store.js";
import type { IssueApiKeyInput, IssueApiKeyResult, VerifyApiKeyResult } from "./types.js";
import { verifyApiKey } from "./verify.js";

/**
 * High-level API key service that wires the pure domain functions to an
 * {@link ApiKeyStore}. Persists records on issuance, lifecycle changes, and
 * usage so the store is always the source of truth.
 */
export class ApiKeyService {
  constructor(private readonly store: ApiKeyStore) {}

  /** All API key records (merchant-wide), for dashboard listing. */
  async list(): Promise<ApiKey[]> {
    return this.store.listAll();
  }

  /** Mint a new key, persist it, and return the one-time plaintext. */
  async issue(input: IssueApiKeyInput, now: Date = new Date()): Promise<IssueApiKeyResult> {
    const result = issueApiKey(input, now);
    await this.store.save(result.apiKey);
    return result;
  }

  /** Verify a presented plaintext key against the store. */
  async verify(plaintext: string): Promise<VerifyApiKeyResult> {
    return verifyApiKey(plaintext, this.store);
  }

  /**
   * Verify a key and confirm it grants every required scope. Returns the same
   * shape as {@link verify}; `valid` is false when the key is invalid OR is
   * missing any required scope.
   */
  async authorize(plaintext: string, requiredScopes: readonly string[]): Promise<VerifyApiKeyResult> {
    const result = await this.verify(plaintext);
    if (!result.valid || !result.apiKey) {
      return { valid: false };
    }
    if (!hasAllScopes(result.apiKey, requiredScopes)) {
      return { valid: false };
    }
    return result;
  }

  /** Check whether the active key behind `plaintext` grants `scope`. */
  async checkScope(plaintext: string, scope: string): Promise<boolean> {
    const result = await this.verify(plaintext);
    return result.valid && result.apiKey !== undefined && hasScope(result.apiKey, scope);
  }

  /**
   * Stamp `lastUsedAt` on the key behind `plaintext` and persist it. Returns the
   * updated record. Throws {@link SettleKitError} (not_found) if no such key.
   */
  async recordUsage(plaintext: string, now: Date = new Date()): Promise<ApiKey> {
    const existing = await this.store.findByHash(hashApiKey(plaintext));
    if (!existing) {
      throw notFound("API key not found");
    }
    const updated = recordUsage(existing, now);
    await this.store.save(updated);
    return updated;
  }

  /**
   * Revoke the key behind `plaintext` and persist it. Returns the updated
   * record. Throws {@link SettleKitError} (not_found) if no such key.
   */
  async revoke(plaintext: string): Promise<ApiKey> {
    const existing = await this.store.findByHash(hashApiKey(plaintext));
    if (!existing) {
      throw notFound("API key not found");
    }
    const updated = revoke(existing);
    await this.store.save(updated);
    return updated;
  }
}
