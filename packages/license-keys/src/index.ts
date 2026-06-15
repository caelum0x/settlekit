import { isPast, type LicenseKey } from "@settlekit/common";
import { createLicenseKey } from "./generate.js";
import type { LicensePolicy } from "./types.js";

// Public types
export type {
  LicensePolicy,
  LicenseKey,
  VerifyReason,
  VerifyResult,
  LicenseTokenPayload,
} from "./types.js";

// Generation
export {
  createLicenseKey,
  generateKeyString,
  isValidKeyFormat,
  policyOf,
  type CreateLicenseKeyInput,
} from "./generate.js";

// Offline tokens
export {
  signLicenseToken,
  verifyLicenseToken,
  issueLicenseToken,
  tokenPayloadFor,
  type VerifyTokenResult,
} from "./token.js";

// Activation (immutable)
export {
  activateMachine,
  deactivateMachine,
  activateDomain,
  deactivateDomain,
  revoke,
} from "./activation.js";

// Verification
export { evaluateStatus, verifyAgainstLicense, type VerifyAgainstLicenseInput } from "./verify.js";

// Store
export { type LicenseStore, InMemoryLicenseStore } from "./store.js";

// Service
export {
  LicenseService,
  type LicenseServiceOptions,
  type VerifyRequest,
} from "./service.js";

/**
 * Backwards-compatible issuance helper accepting a {@link LicensePolicy}.
 * Prefer {@link createLicenseKey} for new code.
 */
export function issueLicenseKey(
  input: {
    organizationId: string;
    customerId: string;
    productId: string;
    entitlementId: string;
    policy: LicensePolicy;
  },
  now: Date = new Date(),
): LicenseKey {
  return createLicenseKey(
    {
      organizationId: input.organizationId,
      customerId: input.customerId,
      productId: input.productId,
      entitlementId: input.entitlementId,
      machineLimit: input.policy.machineLimit,
      domainLimit: input.policy.domainLimit,
      expiresAt: input.policy.expiresAt,
    },
    now,
  );
}

/**
 * Backwards-compatible single-key status check.
 * Prefer {@link verifyAgainstLicense} or {@link LicenseService.verify}.
 */
export function verifyLicenseKey(
  key: LicenseKey,
  now: Date = new Date(),
): { active: boolean; reason?: "revoked" | "expired" } {
  if (key.status === "revoked") return { active: false, reason: "revoked" };
  if (key.expiresAt && isPast(key.expiresAt, now)) return { active: false, reason: "expired" };
  if (key.status === "expired") return { active: false, reason: "expired" };
  return { active: true };
}
