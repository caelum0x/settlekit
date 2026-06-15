/**
 * A real, in-process implementation of the `@settlekit/discord` `DiscordApi`.
 *
 * Honours the interface (list guilds, list roles, add/remove member role) over
 * Map-backed state so the API can drive `grantDiscordRole` /
 * `revokeDiscordRole` without a live bot token. Guilds and roles are seeded so
 * `GET /v1/integrations/discord/guilds|roles` return real data.
 *
 * Guild/role shapes come from the discord package's re-exported
 * `DiscordPartialGuild` / `DiscordRole` aliases so this app needs no direct
 * `discord-api-types` dependency.
 */
import type {
  DiscordApi,
  DiscordPartialGuild,
  DiscordRole,
  DiscordRoleRef,
} from "@settlekit/discord";

function memberRoleKey(ref: DiscordRoleRef): string {
  return `${ref.guildId}:${ref.userId}:${ref.roleId}`;
}

/** In-memory Discord API client with seeded guilds/roles and a role-grant set. */
export class InMemoryDiscordApi implements DiscordApi {
  private readonly guilds: DiscordPartialGuild[];
  private readonly rolesByGuild: Map<string, DiscordRole[]>;
  private readonly memberRoles = new Set<string>();

  constructor(seed?: { guilds?: DiscordPartialGuild[]; roles?: Record<string, DiscordRole[]> }) {
    this.guilds = seed?.guilds ?? defaultGuilds();
    this.rolesByGuild = new Map(Object.entries(seed?.roles ?? defaultRoles()));
  }

  async listGuilds(): Promise<DiscordPartialGuild[]> {
    return this.guilds.map((g) => ({ ...g }));
  }

  async listGuildRoles(guildId: string): Promise<DiscordRole[]> {
    return (this.rolesByGuild.get(guildId) ?? []).map((r) => ({ ...r }));
  }

  async addRole(ref: DiscordRoleRef): Promise<void> {
    this.memberRoles.add(memberRoleKey(ref));
  }

  async removeRole(ref: DiscordRoleRef): Promise<void> {
    this.memberRoles.delete(memberRoleKey(ref));
  }

  /** True when `userId` currently holds `roleId` in `guildId`. */
  hasRole(ref: DiscordRoleRef): boolean {
    return this.memberRoles.has(memberRoleKey(ref));
  }
}

function defaultGuilds(): DiscordPartialGuild[] {
  return [
    {
      id: "100000000000000001",
      name: "SettleKit Community",
      icon: null,
      owner: true,
      permissions: "8",
      features: [],
    } as unknown as DiscordPartialGuild,
  ];
}

function defaultRoles(): Record<string, DiscordRole[]> {
  return {
    "100000000000000001": [
      {
        id: "200000000000000001",
        name: "pro-member",
        color: 3447003,
        hoist: false,
        position: 2,
        permissions: "0",
        managed: false,
        mentionable: true,
      } as unknown as DiscordRole,
      {
        id: "200000000000000002",
        name: "supporter",
        color: 15844367,
        hoist: false,
        position: 1,
        permissions: "0",
        managed: false,
        mentionable: true,
      } as unknown as DiscordRole,
    ],
  };
}
