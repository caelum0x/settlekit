import type { DiscordRoleGrant } from "@settlekit/common";
import type { DiscordAccessClient } from "./types.js";

export async function syncDiscordRoleGrant(client: DiscordAccessClient, grant: DiscordRoleGrant): Promise<DiscordRoleGrant> {
  if (grant.status === "revoked") return grant;
  const active = await client.hasGuildMemberRole({
    guildId: grant.guildId,
    roleId: grant.roleId,
    discordUserId: grant.discordUserId,
  });
  return { ...grant, status: active ? "active" : "failed" };
}
