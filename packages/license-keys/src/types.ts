import type { LicenseKey } from "@settlekit/common";

/**
 * Policy describing the entitlement boundaries a license key enforces.
 * Carried into key issuance and used by the offline validation token.
 */
export interface LicensePolicy {
  id: string;
  /** Max distinct machines that may activate the key. */
  machineLimit: number;
  /** Max distinct domains that may activate the key (optional). */
  domainLimit?: number;
  /** ISO-8601 expiry; absent means the key never expires. */
  expiresAt?: string;
}

/** Reasons a verification can fail, surfaced to the caller. */
export type VerifyReason =
  | "not_found"
  | "revoked"
  | "expired"
  | "machine_limit_exceeded"
  | "domain_limit_exceeded";

/** Result of verifying a license key against a store. */
export interface VerifyResult {
  active: boolean;
  reason?: VerifyReason;
  /** The (possibly mutated) license key after activation side effects. */
  license?: LicenseKey;
}

/**
 * Compact, signable payload embedded in an offline validation token. Kept
 * intentionally small so it round-trips cleanly through base64url.
 */
export interface LicenseTokenPayload {
  /** License key id (lic_...). */
  lid: string;
  productId: string;
  customerId: string;
  /** ISO-8601 expiry, or null for perpetual licenses. */
  expiresAt: string | null;
  machineLimit: number;
  /** Issued-at, ms since epoch. */
  iat: number;
}

export type { LicenseKey } from "@settlekit/common";
