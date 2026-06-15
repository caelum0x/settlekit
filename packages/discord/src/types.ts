import type {
  RESTGetAPICurrentUserGuildsResult,
  RESTGetAPIGuildRolesResult,
} from "discord-api-types/v10";
import type { DiscordRoleGrant } from "@settlekit/common";

/** Base URL for the Discord REST API (v10). */
export const DISCORD_API_BASE = "https://discord.com/api/v10";

/** OAuth2 token endpoint used to exchange authorization codes for access tokens. */
export const DISCORD_OAUTH_TOKEN_URL = "https://discord.com/api/oauth2/token";

/** Authorize URL users are redirected to during the OAuth2 code flow. */
export const DISCORD_OAUTH_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

/**
 * A single guild the bot account belongs to, as returned by
 * `GET /users/@me/guilds`. Narrowed to the element type of the discord-api-types
 * result so callers do not need a direct dependency on discord-api-types.
 */
export type DiscordPartialGuild = RESTGetAPICurrentUserGuildsResult[number];

/** A role within a guild, as returned by `GET /guilds/{guild.id}/roles`. */
export type DiscordRole = RESTGetAPIGuildRolesResult[number];

/** Identifies a single guild member's role for grant/revoke operations. */
export interface DiscordRoleRef {
  guildId: string;
  userId: string;
  roleId: string;
}

/**
 * The minimal HTTP surface the domain logic depends on. The real default
 * implementation ({@link createDiscordClient}) issues fetch-backed Discord REST
 * calls; tests provide an in-memory implementation to drive the pure
 * granter / revoker / sync logic.
 */
export interface DiscordApi {
  /** `GET /users/@me/guilds` — guilds the bot account is a member of. */
  listGuilds(): Promise<DiscordPartialGuild[]>;
  /** `GET /guilds/{guildId}/roles` — roles defined in a guild. */
  listGuildRoles(guildId: string): Promise<DiscordRole[]>;
  /** `PUT /guilds/{guildId}/members/{userId}/roles/{roleId}` — add a role. */
  addRole(ref: DiscordRoleRef): Promise<void>;
  /** `DELETE /guilds/{guildId}/members/{userId}/roles/{roleId}` — remove a role. */
  removeRole(ref: DiscordRoleRef): Promise<void>;
}

/** Options for constructing a real fetch-backed {@link DiscordApi} client. */
export interface DiscordClientOptions {
  /** Discord bot token (sent as `Authorization: Bot <token>`). */
  botToken: string;
  /** Override the API base URL (defaults to {@link DISCORD_API_BASE}). */
  baseUrl?: string;
  /** Injectable fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  /** Audit-log reason attached to mutations via `X-Audit-Log-Reason`. */
  auditReason?: string;
}

/** Input required to grant a paid role to a customer's Discord account. */
export interface GrantDiscordRoleInput {
  organizationId: string;
  guildId: string;
  roleId: string;
  customerId: string;
  entitlementId: string;
  discordUserId: string;
}

export type { DiscordRoleGrant };
