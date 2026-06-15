import { pgTable, text, index } from "drizzle-orm/pg-core";
import { merchants, customers } from "./accounts.js";
import {
  idColumn,
  timestamps,
  metadataColumn,
  nullableTimestamp,
} from "./_shared.js";

/** A merchant's Discord bot connection. */
export const discordConnections = pgTable(
  "discord_connections",
  {
    id: idColumn(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    botToken: text("bot_token").notNull(),
    applicationId: text("application_id").notNull(),
    status: text("status").notNull().default("active"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    merchantIdx: index("discord_connections_merchant_id_idx").on(
      table.merchantId,
    ),
  }),
);

/** A Discord guild (server) managed by a connection. */
export const discordGuilds = pgTable(
  "discord_guilds",
  {
    id: idColumn(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => discordConnections.id),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    connectionIdx: index("discord_guilds_connection_id_idx").on(
      table.connectionId,
    ),
  }),
);

/** A role within a guild that can be granted on purchase. */
export const discordRoles = pgTable(
  "discord_roles",
  {
    id: idColumn(),
    guildId: text("guild_id")
      .notNull()
      .references(() => discordGuilds.id),
    roleId: text("role_id").notNull(),
    name: text("name").notNull(),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    guildIdx: index("discord_roles_guild_id_idx").on(table.guildId),
  }),
);

/** A grant of a Discord role tied to an entitlement. */
export const discordRoleGrants = pgTable(
  "discord_role_grants",
  {
    id: idColumn(),
    roleId: text("role_id")
      .notNull()
      .references(() => discordRoles.id),
    customerId: text("customer_id")
      .notNull()
      .references(() => customers.id),
    entitlementId: text("entitlement_id"),
    discordUserId: text("discord_user_id"),
    status: text("status").notNull().default("pending"),
    grantedAt: nullableTimestamp("granted_at"),
    revokedAt: nullableTimestamp("revoked_at"),
    metadata: metadataColumn(),
    ...timestamps,
  },
  (table) => ({
    roleIdx: index("discord_role_grants_role_id_idx").on(table.roleId),
    customerIdx: index("discord_role_grants_customer_id_idx").on(
      table.customerId,
    ),
  }),
);
