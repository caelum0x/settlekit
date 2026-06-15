/**
 * Postgres-backed {@link GrantStore} (@settlekit/file-delivery). The canonical
 * DownloadGrant lives in `metadata.__doc`; typed columns are projected for
 * querying. `merchant_id` projects the seeded default; `expires_at` converts the
 * grant's unix-second expiry to a timestamptz; `status` reflects revocation.
 */
import { eq, type Database, downloadGrants } from "@settlekit/database";
import type { GrantStore, DownloadGrant } from "@settlekit/file-delivery";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

function projectionFor(grant: DownloadGrant) {
  return {
    merchantId: DEFAULT_MERCHANT_ID,
    fileId: grant.fileId,
    customerId: grant.customerId,
    downloadToken: grant.downloadToken,
    status: grant.revoked ? "revoked" : "active",
    downloadsRemaining: grant.downloadsRemaining,
    expiresAt: new Date(grant.expiresAt * 1000),
    metadata: packDoc(grant),
  };
}

export class PgGrantStore implements GrantStore {
  constructor(private readonly db: Database) {}

  async create(grant: DownloadGrant): Promise<DownloadGrant> {
    const existing = await this.get(grant.id);
    if (existing) throw new Error(`grant already exists: ${grant.id}`);
    const tokenOwner = await this.getByDownloadToken(grant.downloadToken);
    if (tokenOwner) throw new Error(`download token already in use: ${grant.downloadToken}`);
    await this.db.insert(downloadGrants).values({ id: grant.id, ...projectionFor(grant) });
    return grant;
  }

  async get(id: string): Promise<DownloadGrant | null> {
    const rows = await this.db
      .select({ metadata: downloadGrants.metadata })
      .from(downloadGrants)
      .where(eq(downloadGrants.id, id))
      .limit(1);
    return unpackDoc<DownloadGrant>(rows[0]);
  }

  async getByDownloadToken(downloadToken: string): Promise<DownloadGrant | null> {
    const rows = await this.db
      .select({ metadata: downloadGrants.metadata })
      .from(downloadGrants)
      .where(eq(downloadGrants.downloadToken, downloadToken))
      .limit(1);
    return unpackDoc<DownloadGrant>(rows[0]);
  }

  async update(grant: DownloadGrant): Promise<DownloadGrant> {
    const existing = await this.get(grant.id);
    if (!existing) throw new Error(`grant not found: ${grant.id}`);
    await this.db
      .update(downloadGrants)
      .set(projectionFor(grant))
      .where(eq(downloadGrants.id, grant.id));
    return grant;
  }

  async listByFile(fileId: string): Promise<DownloadGrant[]> {
    const rows = await this.db
      .select({ metadata: downloadGrants.metadata })
      .from(downloadGrants)
      .where(eq(downloadGrants.fileId, fileId));
    return unpackDocs<DownloadGrant>(rows);
  }

  async listByCustomer(customerId: string): Promise<DownloadGrant[]> {
    const rows = await this.db
      .select({ metadata: downloadGrants.metadata })
      .from(downloadGrants)
      .where(eq(downloadGrants.customerId, customerId));
    return unpackDocs<DownloadGrant>(rows);
  }
}
