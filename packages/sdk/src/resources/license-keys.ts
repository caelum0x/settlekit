/**
 * License keys resource client. Maps to `/v1/license-keys`.
 */
import type { LicenseKey } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link LicenseKeysResource.issue}. */
export interface IssueLicenseKeyInput {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  machineLimit?: number;
  domainLimit?: number;
  expiresAt?: string;
}

/** Input for {@link LicenseKeysResource.verify}. */
export interface VerifyLicenseKeyInput {
  licenseKey: string;
  productId: string;
  machineId: string;
}

/** Result of verifying a license key. */
export interface VerifyLicenseKeyResult {
  valid: boolean;
  license?: LicenseKey;
  reason?: string;
  [key: string]: unknown;
}

/** Client for license key endpoints. */
export class LicenseKeysResource {
  constructor(private readonly http: HttpClient) {}

  /** Issue a machine/domain-limited license key. */
  issue(input: IssueLicenseKeyInput, options?: RequestOptions): Promise<LicenseKey> {
    return this.http.post<LicenseKey>("/v1/license-keys", input, options);
  }

  /** Verify a presented license key for a product + machine. */
  verify(input: VerifyLicenseKeyInput, options?: RequestOptions): Promise<VerifyLicenseKeyResult> {
    return this.http.post<VerifyLicenseKeyResult>("/v1/license-keys/verify", input, options);
  }

  /** Mint an offline validation token for an existing license. */
  issueToken(id: string, options?: RequestOptions): Promise<{ token: string }> {
    return this.http.post<{ token: string }>(
      `/v1/license-keys/${encodeURIComponent(id)}/token`,
      undefined,
      options,
    );
  }

  /** Revoke a license key. */
  revoke(id: string, options?: RequestOptions): Promise<LicenseKey> {
    return this.http.post<LicenseKey>(
      `/v1/license-keys/${encodeURIComponent(id)}/revoke`,
      undefined,
      options,
    );
  }
}
