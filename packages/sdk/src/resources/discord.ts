/**
 * Discord integration resource client.
 *
 * Maps to `/v1/integrations/discord` (connect / guilds / roles) and
 * `/v1/discord/access` (grant / revoke).
 */
import type { DiscordConnection, DiscordRoleGrant } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link DiscordResource.connect}. */
export interface ConnectDiscordInput {
  organizationId: string;
  guildId: string;
  guildName: string;
  botTokenRef: string;
}

/** Input for {@link DiscordResource.grant}. */
export interface GrantDiscordRoleInput {
  organizationId: string;
  guildId: string;
  roleId: string;
  customerId: string;
  entitlementId: string;
  discordUserId: string;
}

/** A guild summary returned by `listGuilds`. */
export interface DiscordGuildSummary {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** An assignable role summary returned by `listRoles`. */
export interface DiscordRoleSummary {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** Client for Discord integration + access endpoints. */
export class DiscordResource {
  constructor(private readonly http: HttpClient) {}

  /** Connect a Discord guild. */
  connect(input: ConnectDiscordInput, options?: RequestOptions): Promise<DiscordConnection> {
    return this.http.post<DiscordConnection>("/v1/integrations/discord/connect", input, options);
  }

  /** List the bot's guilds. */
  listGuilds(options?: RequestOptions): Promise<DiscordGuildSummary[]> {
    return this.http.get<DiscordGuildSummary[]>("/v1/integrations/discord/guilds", options);
  }

  /** List assignable roles in a guild. */
  listRoles(guildId: string, options?: RequestOptions): Promise<DiscordRoleSummary[]> {
    return this.http.get<DiscordRoleSummary[]>("/v1/integrations/discord/roles", {
      ...options,
      query: { guildId },
    });
  }

  /** Grant a paid role to a Discord user. */
  grant(input: GrantDiscordRoleInput, options?: RequestOptions): Promise<DiscordRoleGrant> {
    return this.http.post<DiscordRoleGrant>("/v1/discord/access/grant", input, options);
  }

  /** Revoke a recorded role grant. */
  revoke(grantId: string, options?: RequestOptions): Promise<DiscordRoleGrant> {
    return this.http.post<DiscordRoleGrant>("/v1/discord/access/revoke", { grantId }, options);
  }
}
