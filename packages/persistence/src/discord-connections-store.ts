/**
 * Postgres-backed {@link EntityStore} for Discord connections.
 * Canonical DiscordConnection in `metadata.__doc`; typed columns projected for querying.
 *
 * The DiscordConnection domain type carries `organizationId` (not `merchantId`),
 * but `discord_connections` has a NOT NULL `merchant_id` FK — so we project
 * {@link DEFAULT_MERCHANT_ID}. `botTokenRef` maps to the NOT NULL `bot_token`
 * column; the domain has no `applicationId`, so we project an empty string to
 * satisfy that NOT NULL column (the document remains the source of truth).
 */
import { eq, type Database, discordConnections } from "@settlekit/database";
import type { DiscordConnection } from "@settlekit/common";
import type { EntityStore } from "./entity-store.js";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export class PgDiscordConnectionStore implements EntityStore<DiscordConnection> {
  constructor(private readonly db: Database) {}

  async save(entity: DiscordConnection): Promise<DiscordConnection> {
    const projection = {
      merchantId: DEFAULT_MERCHANT_ID,
      botToken: entity.botTokenRef,
      applicationId: "",
      metadata: packDoc(entity),
    };
    await this.db
      .insert(discordConnections)
      .values({ id: entity.id, ...projection })
      .onConflictDoUpdate({ target: discordConnections.id, set: projection });
    return entity;
  }

  async findById(id: string): Promise<DiscordConnection | null> {
    const rows = await this.db
      .select({ metadata: discordConnections.metadata })
      .from(discordConnections)
      .where(eq(discordConnections.id, id))
      .limit(1);
    return unpackDoc<DiscordConnection>(rows[0]);
  }

  async list(
    predicate?: (entity: DiscordConnection) => boolean,
  ): Promise<DiscordConnection[]> {
    const rows = await this.db
      .select({ metadata: discordConnections.metadata })
      .from(discordConnections);
    const all = unpackDocs<DiscordConnection>(rows);
    return predicate ? all.filter(predicate) : all;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db
      .delete(discordConnections)
      .where(eq(discordConnections.id, id))
      .returning({ id: discordConnections.id });
    return res.length > 0;
  }
}
