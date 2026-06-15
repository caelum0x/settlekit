import type { ApiKey } from "@settlekit/common";

/** Which key namespace a plaintext key belongs to. */
export type ApiKeyEnv = "live" | "test";

/** Input required to mint a new API key for a customer + product. */
export interface IssueApiKeyInput {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  scopes: string[];
  env: ApiKeyEnv;
}

/**
 * Result of issuance. `plaintext` is the only time the raw secret is ever
 * available; only the SHA-256 hash is persisted on the {@link ApiKey} record.
 */
export interface IssueApiKeyResult {
  apiKey: ApiKey;
  plaintext: string;
}

/** Result of verifying a presented plaintext key against the store. */
export interface VerifyApiKeyResult {
  valid: boolean;
  apiKey?: ApiKey;
}
