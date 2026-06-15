import { isPast, type LicenseKey } from "@settlekit/common";
import { activateMachine } from "./activation.js";
import type { VerifyReason, VerifyResult } from "./types.js";

/**
 * Pure status check for a single license key (no machine activation).
 * Used by both the store-backed verify and lightweight callers.
 */
export function evaluateStatus(
  license: LicenseKey,
  now: Date = new Date(),
): { active: boolean; reason?: Extract<VerifyReason, "revoked" | "expired"> } {
  if (license.status === "revoked") return { active: false, reason: "revoked" };
  if (license.expiresAt && isPast(license.expiresAt, now)) return { active: false, reason: "expired" };
  if (license.status === "expired") return { active: false, reason: "expired" };
  return { active: true };
}

export interface VerifyAgainstLicenseInput {
  license: LicenseKey;
  productId: string;
  machineId: string;
}

/**
 * Verify a license for a product + machine, activating the machine when it is
 * new and within capacity. Pure: returns a new license in `result.license`
 * reflecting any activation; callers persist it via the store.
 */
export function verifyAgainstLicense(input: VerifyAgainstLicenseInput, now: Date = new Date()): VerifyResult {
  const { license, productId, machineId } = input;

  if (license.productId !== productId) {
    return { active: false, reason: "not_found", license };
  }

  const status = evaluateStatus(license, now);
  if (!status.active) {
    return { active: false, reason: status.reason, license };
  }

  // Known machine: already activated, pass through.
  if (license.activatedMachineIds.includes(machineId)) {
    return { active: true, license };
  }

  // New machine: activate if capacity remains, otherwise reject.
  if (license.activatedMachineIds.length >= license.machineLimit) {
    return { active: false, reason: "machine_limit_exceeded", license };
  }

  const activated = activateMachine(license, machineId);
  return { active: true, license: activated };
}
