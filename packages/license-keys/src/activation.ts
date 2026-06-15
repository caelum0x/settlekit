import { conflict, type LicenseKey } from "@settlekit/common";

/**
 * Activate a machine against a license, immutably.
 *
 * - Re-activating an already-known machine is idempotent (returns an equal copy).
 * - Exceeding `machineLimit` throws a `conflict` SettleKitError.
 */
export function activateMachine(license: LicenseKey, machineId: string): LicenseKey {
  if (!machineId) throw new RangeError("machineId must be a non-empty string");
  if (license.activatedMachineIds.includes(machineId)) {
    return { ...license, activatedMachineIds: [...license.activatedMachineIds] };
  }
  if (license.activatedMachineIds.length >= license.machineLimit) {
    throw conflict("machine activation limit exceeded", {
      licenseId: license.id,
      machineLimit: license.machineLimit,
    });
  }
  return { ...license, activatedMachineIds: [...license.activatedMachineIds, machineId] };
}

/** Deactivate a machine, immutably. Unknown machines are a no-op. */
export function deactivateMachine(license: LicenseKey, machineId: string): LicenseKey {
  return {
    ...license,
    activatedMachineIds: license.activatedMachineIds.filter((id) => id !== machineId),
  };
}

/**
 * Activate a domain against a license, immutably. Honors `domainLimit` when set;
 * an unset `domainLimit` means domains are not capped.
 */
export function activateDomain(license: LicenseKey, domain: string): LicenseKey {
  if (!domain) throw new RangeError("domain must be a non-empty string");
  const normalized = domain.trim().toLowerCase();
  if (license.activatedDomains.includes(normalized)) {
    return { ...license, activatedDomains: [...license.activatedDomains] };
  }
  if (license.domainLimit !== undefined && license.activatedDomains.length >= license.domainLimit) {
    throw conflict("domain activation limit exceeded", {
      licenseId: license.id,
      domainLimit: license.domainLimit,
    });
  }
  return { ...license, activatedDomains: [...license.activatedDomains, normalized] };
}

/** Deactivate a domain, immutably. Unknown domains are a no-op. */
export function deactivateDomain(license: LicenseKey, domain: string): LicenseKey {
  const normalized = domain.trim().toLowerCase();
  return {
    ...license,
    activatedDomains: license.activatedDomains.filter((d) => d !== normalized),
  };
}

/** Revoke a license, immutably. Idempotent. */
export function revoke(license: LicenseKey): LicenseKey {
  return { ...license, status: "revoked" };
}
