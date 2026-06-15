/**
 * Example: issue and verify a software license with machine activation.
 *
 * Exercises @settlekit/license-keys for real:
 *   1. Issue a license key (machine-limited) through LicenseService.
 *   2. Verify it for a machine -> activates the machine (within capacity).
 *   3. Verify a second machine within the limit -> still active.
 *   4. Verify a third machine over the limit -> rejected (machine_limit_exceeded).
 *   5. Issue + verify an offline validation token (HMAC).
 */
import {
  LicenseService,
  InMemoryLicenseStore,
  issueLicenseToken,
  verifyLicenseToken,
} from "@settlekit/license-keys";
import { generateId } from "@settlekit/common";

export interface LicenseVerifyResult {
  licenseId: string;
  key: string;
  machine1Active: boolean;
  machine2Active: boolean;
  machine3Active: boolean;
  machine3Reason: string | undefined;
  tokenValid: boolean;
}

const TOKEN_SECRET = "example-hmac-secret-do-not-use-in-prod";

export async function main(): Promise<LicenseVerifyResult> {
  const organizationId = "org_license_example";
  const customerId = "cust_license_example";
  const productId = "prod_license_example";

  const store = new InMemoryLicenseStore();
  const service = new LicenseService(store, { tokenSecret: TOKEN_SECRET });

  // 1. Issue a license key allowing up to 2 machine activations.
  const license = await service.issue({
    organizationId,
    customerId,
    productId,
    entitlementId: generateId("entitlement"),
    machineLimit: 2,
  });

  // 2. Verify for the first machine -> activates it.
  const v1 = await service.verify({
    licenseKey: license.key,
    productId,
    machineId: "machine-aaa",
  });

  // 3. Verify for a second machine -> still within the limit.
  const v2 = await service.verify({
    licenseKey: license.key,
    productId,
    machineId: "machine-bbb",
  });

  // 4. Verify a third, distinct machine -> over the limit, rejected.
  const v3 = await service.verify({
    licenseKey: license.key,
    productId,
    machineId: "machine-ccc",
  });

  if (!v1.active || !v2.active) {
    throw new Error("expected first two machines to activate");
  }
  if (v3.active || v3.reason !== "machine_limit_exceeded") {
    throw new Error(`expected third machine over limit, got: ${JSON.stringify(v3)}`);
  }

  // 5. Offline token: sign for the activated license, then verify the HMAC.
  const stored = await store.findById(license.id);
  if (!stored) throw new Error("license vanished from store");
  const token = issueLicenseToken(stored, TOKEN_SECRET);
  const tokenResult = verifyLicenseToken(token, TOKEN_SECRET);
  if (!tokenResult.valid) {
    throw new Error(`expected offline token to validate: ${JSON.stringify(tokenResult)}`);
  }

  return {
    licenseId: license.id,
    key: license.key,
    machine1Active: v1.active,
    machine2Active: v2.active,
    machine3Active: v3.active,
    machine3Reason: v3.reason,
    tokenValid: tokenResult.valid,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      console.log("[license-verify]", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("[license-verify] failed", err);
      process.exitCode = 1;
    });
}
