import type { DiscordApi, DiscordPartialGuild } from "./types.js";

/** A compact view of a guild for selection UIs. */
export interface DiscordGuildSummary {
  id: string;
  name: string;
  /** True when the bot owns the guild (always able to manage roles). */
  owner: boolean;
}

/** Fetch the guilds the bot belongs to via `GET /users/@me/guilds`. */
export async function listGuilds(api: DiscordApi): Promise<DiscordPartialGuild[]> {
  return api.listGuilds();
}

/** Project Discord partial guilds onto a stable, name-sorted summary list. */
export function toGuildSummaries(guilds: readonly DiscordPartialGuild[]): DiscordGuildSummary[] {
  return guilds
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      owner: guild.owner === true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Find a single guild by id within a fetched list, or undefined. */
export function findGuild(
  guilds: readonly DiscordPartialGuild[],
  guildId: string,
): DiscordPartialGuild | undefined {
  return guilds.find((guild) => guild.id === guildId);
}
