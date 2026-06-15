/**
 * Postgres-backed {@link EntityStore} for GitHub App installations.
 * Canonical GitHubInstallation in `metadata.__doc`; typed columns projected for querying.
 *
 * The GitHubInstallation domain type carries `organizationId` (not `merchantId`),
 * but `github_installations` has a NOT NULL `merchant_id` FK — so we project
 * {@link DEFAULT_MERCHANT_ID}.
 */
import { eq, type Database, githubInstallations } from "@settlekit/database";
import type { GitHubInstallation } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";
import { DEFAULT_MERCHANT_ID } from "../seed.js";

export class PgGitHubInstallationStore implements EntityStore<GitHubInstallation> {
  constructor(private readonly db: Database) {}

  async save(entity: GitHubInstallation): Promise<GitHubInstallation> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      installationId: entity.installationId,
      accountLogin: entity.accountLogin,
      accountType: entity.accountType,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(githubInstallations)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: githubInstallations.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<GitHubInstallation | null> {
    const rows = await this.db
      .select({ metadata: githubInstallations.metadata })
      .from(githubInstallations)
      .where(eq(githubInstallations.id, id))
      .limit(1);
    return unpackDoc<GitHubInstallation>(rows[0]);
  }

  async list(
    predicate?: (entity: GitHubInstallation) => boolean,
  ): Promise<GitHubInstallation[]> {
    const rows = await this.db
      .select({ metadata: githubInstallations.metadata })
      .from(githubInstallations);
    const all = unpackDocs<GitHubInstallation>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(githubInstallations)
      .where(eq(githubInstallations.id, id))
      .returning({ id: githubInstallations.id });
    return res.length > 0;
  }
}
