import type { DiscordRoleGrant } from "@settlekit/common";
import type { DiscordAccessClient } from "./types.js";

export async function revokeDiscordRole(client: DiscordAccessClient, grant: DiscordRoleGrant): Promise<void> {
  await client.removeGuildMemberRole({
    guildId: grant.guildId,
    roleId: grant.roleId,
    discordUserId: grant.discordUserId,
  });
}

export function markDiscordRoleRevoked(grant: DiscordRoleGrant, now = new Date()): DiscordRoleGrant {
  return { ...grant, status: "revoked", revokedAt: now.toISOString() };
}
