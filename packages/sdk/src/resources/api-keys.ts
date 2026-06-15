/**
 * API keys resource client. Maps to `/v1/api-keys`.
 *
 * The plaintext secret is returned exactly once on issuance.
 */
import type { ApiKey } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link ApiKeysResource.issue}. */
export interface IssueApiKeyInput {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  scopes: string[];
  env?: "live" | "test";
}

/** Result of issuing an API key (plaintext shown once). */
export interface IssueApiKeyResult {
  apiKey: ApiKey;
  plaintext: string;
}

/** Input for {@link ApiKeysResource.verify}. */
export interface VerifyApiKeyInput {
  key: string;
  requiredScopes?: string[];
}

/** Result of verifying an API key. */
export interface VerifyApiKeyResult {
  valid: boolean;
  apiKey?: ApiKey;
}

/** Client for API key endpoints. */
export class ApiKeysResource {
  constructor(private readonly http: HttpClient) {}

  /** Issue a new scoped API key. Returns the one-time plaintext. */
  issue(input: IssueApiKeyInput, options?: RequestOptions): Promise<IssueApiKeyResult> {
    return this.http.post<IssueApiKeyResult>("/v1/api-keys", input, options);
  }

  /** Verify a presented key (and optional required scopes). */
  verify(input: VerifyApiKeyInput, options?: RequestOptions): Promise<VerifyApiKeyResult> {
    return this.http.post<VerifyApiKeyResult>("/v1/api-keys/verify", input, options);
  }

  /** Revoke a key by its plaintext value. */
  revoke(key: string, options?: RequestOptions): Promise<ApiKey> {
    return this.http.post<ApiKey>("/v1/api-keys/revoke", { key }, options);
  }
}
