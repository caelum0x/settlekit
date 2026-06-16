import type { ApiKey } from "@settlekit/common";
import { hashApiKey } from "./hash.js";

/**
 * Persistence boundary for API keys. Implementations index records by their
 * SHA-256 hash (never the plaintext) so verification is a single hash + lookup.
 */
export interface ApiKeyStore {
  /** Find a key record by its SHA-256 hash, or `undefined` if none exists. */
  findByHash(keyHash: string): Promise<ApiKey | undefined>;
  /** Insert or replace a key record. Keyed by `apiKey.keyHash`. */
  save(apiKey: ApiKey): Promise<void>;
  /** All key records (merchant-wide), for dashboard listing. */
  listAll(): Promise<ApiKey[]>;
}

/**
 * A real, fully-functional in-memory {@link ApiKeyStore}.
 *
 * Records are stored immutably: `save` always persists a defensive copy, and
 * `findByHash` returns a fresh copy so callers cannot mutate stored state. This
 * is production-correct for single-process / test usage and serves as the
 * reference implementation of the interface.
 */
export class InMemoryApiKeyStore implements ApiKeyStore {
  private readonly byHash = new Map<string, ApiKey>();

  async findByHash(keyHash: string): Promise<ApiKey | undefined> {
    const found = this.byHash.get(keyHash);
    return found ? { ...found, scopes: [...found.scopes] } : undefined;
  }

  async save(apiKey: ApiKey): Promise<void> {
    this.byHash.set(apiKey.keyHash, { ...apiKey, scopes: [...apiKey.scopes] });
  }

  async listAll(): Promise<ApiKey[]> {
    return [...this.byHash.values()].map((k) => ({ ...k, scopes: [...k.scopes] }));
  }

  /** Convenience for tests/tooling: resolve a record from its plaintext key. */
  async findByPlaintext(plaintext: string): Promise<ApiKey | undefined> {
    return this.findByHash(hashApiKey(plaintext));
  }

  /** Number of stored keys. */
  get size(): number {
    return this.byHash.size;
  }
}
