/**
 * Postgres-backed {@link EntityStore} for GitHub repo access grants.
 * Canonical GitHubRepoAccessGrant in `metadata.__doc`; typed columns projected
 * for querying.
 *
 * The domain `installationId` is a numeric GitHub id; the
 * `github_repo_access_grants.installation_id` column is text, so we project the
 * stringified value to satisfy the NOT NULL column (the document remains the
 * source of truth on read).
 */
import { eq, type Database, githubRepoAccessGrants } from "@settlekit/database";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";

export class PgGitHubRepoAccessGrantStore
  implements EntityStore<GitHubRepoAccessGrant>
{
  constructor(private readonly db: Database) {}

  async save(entity: GitHubRepoAccessGrant): Promise<GitHubRepoAccessGrant> {
    const projection = {
      installationId: String(entity.installationId),
      customerId: entity.customerId,
      status: entity.status,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(githubRepoAccessGrants)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: githubRepoAccessGrants.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<GitHubRepoAccessGrant | null> {
    const rows = await this.db
      .select({ metadata: githubRepoAccessGrants.metadata })
      .from(githubRepoAccessGrants)
      .where(eq(githubRepoAccessGrants.id, id))
      .limit(1);
    return unpackDoc<GitHubRepoAccessGrant>(rows[0]);
  }

  async list(
    predicate?: (entity: GitHubRepoAccessGrant) => boolean,
  ): Promise<GitHubRepoAccessGrant[]> {
    const rows = await this.db
      .select({ metadata: githubRepoAccessGrants.metadata })
      .from(githubRepoAccessGrants);
    const all = unpackDocs<GitHubRepoAccessGrant>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(githubRepoAccessGrants)
      .where(eq(githubRepoAccessGrants.id, id))
      .returning({ id: githubRepoAccessGrants.id });
    return res.length > 0;
  }
}
