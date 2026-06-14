import { generateId, type DiscordRoleGrant } from "@settlekit/common";
import type { DiscordAccessClient, GrantDiscordRoleInput } from "./types.js";

export async function grantDiscordRole(
  client: DiscordAccessClient,
  input: GrantDiscordRoleInput,
  now = new Date(),
): Promise<DiscordRoleGrant> {
  await client.addGuildMemberRole({
    guildId: input.guildId,
    roleId: input.roleId,
    discordUserId: input.discordUserId,
  });
  return {
    id: generateId("discordRoleAccess"),
    organizationId: input.organizationId,
    guildId: input.guildId,
    roleId: input.roleId,
    customerId: input.customerId,
    entitlementId: input.entitlementId,
    discordUserId: input.discordUserId,
    status: "active",
    createdAt: now.toISOString(),
  };
}
