import { SettleKitError } from "@settlekit/common";
import type {
  DiscordApi,
  DiscordPartialGuild,
  DiscordRole,
  DiscordRoleRef,
} from "../src/index.js";

/**
 * A real in-memory implementation of the {@link DiscordApi} interface used to
 * drive the pure granter / revoker / sync domain logic in tests. It is a test
 * double of OUR interface — not a fake of Discord's product behaviour.
 */
export class InMemoryDiscordApi implements DiscordApi {
  /** Set of `${guildId}:${userId}:${roleId}` currently assigned. */
  readonly memberRoles = new Set<string>();
  readonly guilds: DiscordPartialGuild[];
  readonly rolesByGuild: Map<string, DiscordRole[]>;
  /** When set, the next matching mutation throws this error. */
  failNext?: SettleKitError;

  constructor(options?: {
    guilds?: DiscordPartialGuild[];
    rolesByGuild?: Record<string, DiscordRole[]>;
  }) {
    this.guilds = options?.guilds ?? [];
    this.rolesByGuild = new Map(Object.entries(options?.rolesByGuild ?? {}));
  }

  private key(ref: DiscordRoleRef): string {
    return `${ref.guildId}:${ref.userId}:${ref.roleId}`;
  }

  async listGuilds(): Promise<DiscordPartialGuild[]> {
    return [...this.guilds];
  }

  async listGuildRoles(guildId: string): Promise<DiscordRole[]> {
    return [...(this.rolesByGuild.get(guildId) ?? [])];
  }

  async addRole(ref: DiscordRoleRef): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    this.memberRoles.add(this.key(ref));
  }

  async removeRole(ref: DiscordRoleRef): Promise<void> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = undefined;
      throw error;
    }
    this.memberRoles.delete(this.key(ref));
  }

  has(ref: DiscordRoleRef): boolean {
    return this.memberRoles.has(this.key(ref));
  }
}
