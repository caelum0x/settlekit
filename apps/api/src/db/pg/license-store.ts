/**
 * Postgres-backed {@link LicenseStore}.
 * Canonical LicenseKey in `metadata.__doc`; columns projected for querying.
 * The `license_keys` table has no customer column, so `listByCustomer` reads
 * all rows and filters on the canonical document's `customerId`.
 */
import { eq, type Database, licenseKeys } from "@settlekit/database";
import type { LicenseKey } from "@settlekit/common";
import type { LicenseStore } from "@settlekit/license-keys";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgLicenseStore implements LicenseStore {
  constructor(private readonly db: Database) {}

  async save(license: LicenseKey): Promise<LicenseKey> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      entitlementId: license.entitlementId ?? null,
      key: license.key,
      status: license.status,
      maxActivations: license.machineLimit,
      expiresAt: license.expiresAt ? new Date(license.expiresAt) : null,
      metadata: packDoc(license),
    };
    await this.db
      .insert(licenseKeys)
      .values({ id: license.id, ...projection })
      .onConflictDoUpdate({ target: licenseKeys.id, set: projection });
    return license;
  }

  async findById(id: string): Promise<LicenseKey | null> {
    const rows = await this.db
      .select({ metadata: licenseKeys.metadata })
      .from(licenseKeys)
      .where(eq(licenseKeys.id, id))
      .limit(1);
    return unpackDoc<LicenseKey>(rows[0]);
  }

  async findByKey(key: string): Promise<LicenseKey | null> {
    const rows = await this.db
      .select({ metadata: licenseKeys.metadata })
      .from(licenseKeys)
      .where(eq(licenseKeys.key, key))
      .limit(1);
    return unpackDoc<LicenseKey>(rows[0]);
  }

  async listByCustomer(customerId: string): Promise<LicenseKey[]> {
    const rows = await this.db
      .select({ metadata: licenseKeys.metadata })
      .from(licenseKeys);
    const all = unpackDocs<LicenseKey>(rows);
    return all.filter((l) => l.customerId === customerId);
  }
}
