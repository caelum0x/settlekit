/**
 * Postgres-backed {@link ApiKeyStore}.
 * Canonical ApiKey in `metadata.__doc`; columns projected for querying.
 * Records are indexed by their SHA-256 hash (`hashed_key`), never plaintext.
 */
import { eq, type Database, apiKeys } from "@settlekit/database";
import type { ApiKey } from "@settlekit/common";
import type { ApiKeyStore } from "@settlekit/api-keys";
import { packDoc, unpackDoc } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export class PgApiKeyStore implements ApiKeyStore {
  constructor(private readonly db: Database) {}

  async save(apiKey: ApiKey): Promise<void> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      name: apiKey.keyPrefix,
      prefix: apiKey.keyPrefix,
      hashedKey: apiKey.keyHash,
      scopes: apiKey.scopes,
      status: apiKey.status,
      metadata: packDoc(apiKey),
    };
    await this.db
      .insert(apiKeys)
      .values({ id: apiKey.id, ...projection })
      .onConflictDoUpdate({ target: apiKeys.id, set: projection });
  }

  async findByHash(keyHash: string): Promise<ApiKey | undefined> {
    const rows = await this.db
      .select({ metadata: apiKeys.metadata })
      .from(apiKeys)
      .where(eq(apiKeys.hashedKey, keyHash))
      .limit(1);
    return unpackDoc<ApiKey>(rows[0]) ?? undefined;
  }
}
