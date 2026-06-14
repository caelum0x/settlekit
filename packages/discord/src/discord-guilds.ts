export interface DiscordGuildSummary {
  id: string;
  name: string;
}

export function sortGuildsByName(guilds: DiscordGuildSummary[]): DiscordGuildSummary[] {
  return [...guilds].sort((a, b) => a.name.localeCompare(b.name));
}
