import { generateId, generateSecret, isPast, type LicenseKey } from "@settlekit/common";
import type { LicensePolicy } from "./types.js";

export type { LicensePolicy } from "./types.js";

export function issueLicenseKey(input: {
  organizationId: string;
  customerId: string;
  productId: string;
  entitlementId: string;
  policy: LicensePolicy;
}, now = new Date()): LicenseKey {
  return {
    id: generateId("licenseKey"),
    organizationId: input.organizationId,
    customerId: input.customerId,
    productId: input.productId,
    entitlementId: input.entitlementId,
    key: `sk_lic_${generateSecret(24)}`,
    status: "active",
    machineLimit: input.policy.machineLimit,
    activatedMachineIds: [],
    domainLimit: input.policy.domainLimit,
    activatedDomains: [],
    expiresAt: input.policy.expiresAt,
    createdAt: now.toISOString(),
  };
}

export function verifyLicenseKey(key: LicenseKey, now = new Date()): { active: boolean; reason?: "revoked" | "expired" } {
  if (key.status === "revoked") return { active: false, reason: "revoked" };
  if (key.expiresAt && isPast(key.expiresAt, now)) return { active: false, reason: "expired" };
  return { active: key.status === "active" };
}

export function activateMachine(key: LicenseKey, machineId: string): LicenseKey {
  if (key.activatedMachineIds.includes(machineId)) return key;
  if (key.activatedMachineIds.length >= key.machineLimit) throw new RangeError("machine activation limit exceeded");
  return { ...key, activatedMachineIds: [...key.activatedMachineIds, machineId] };
}
