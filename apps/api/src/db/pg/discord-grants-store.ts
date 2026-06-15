/**
 * Postgres-backed {@link EntityStore} for Discord role grants.
 * Canonical DiscordRoleGrant in `metadata.__doc`; typed columns projected for querying.
 */
import { eq, type Database, discordRoleGrants } from "@settlekit/database";
import type { DiscordRoleGrant } from "@settlekit/common";
import type { EntityStore } from "../entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "../codec.js";

export class PgDiscordRoleGrantStore implements EntityStore<DiscordRoleGrant> {
  constructor(private readonly db: Database) {}

  async save(entity: DiscordRoleGrant): Promise<DiscordRoleGrant> {
    const projection = {
      roleId: entity.roleId,
      customerId: entity.customerId,
      status: entity.status,
      metadata: packDoc(entity),
    };
    await this.db
      .insert(discordRoleGrants)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: discordRoleGrants.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<DiscordRoleGrant | null> {
    const rows = await this.db
      .select({ metadata: discordRoleGrants.metadata })
      .from(discordRoleGrants)
      .where(eq(discordRoleGrants.id, id))
      .limit(1);
    return unpackDoc<DiscordRoleGrant>(rows[0]);
  }

  async list(
    predicate?: (entity: DiscordRoleGrant) => boolean,
  ): Promise<DiscordRoleGrant[]> {
    const rows = await this.db
      .select({ metadata: discordRoleGrants.metadata })
      .from(discordRoleGrants);
    const all = unpackDocs<DiscordRoleGrant>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(discordRoleGrants)
      .where(eq(discordRoleGrants.id, id))
      .returning({ id: discordRoleGrants.id });
    return res.length > 0;
  }
}
