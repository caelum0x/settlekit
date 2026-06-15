import { generateId, toIso, type DiscordRoleGrant } from "@settlekit/common";
import type { DiscordApi, GrantDiscordRoleInput } from "./types.js";
import { toDiscordTransportError } from "./discord-errors.js";

/**
 * Grant a paid Discord role to a customer's account.
 *
 * Calls `PUT /guilds/{guild}/members/{user}/roles/{role}` via the supplied
 * {@link DiscordApi}. On success returns an `active` {@link DiscordRoleGrant};
 * if Discord rejects the call, the error is normalized to a SettleKitError and
 * a `failed` grant is returned so the caller can persist the attempt for retry.
 */
export async function grantDiscordRole(
  api: DiscordApi,
  input: GrantDiscordRoleInput,
  now: Date = new Date(),
): Promise<DiscordRoleGrant> {
  const base: Omit<DiscordRoleGrant, "status"> = {
    id: generateId("discordRoleAccess"),
    organizationId: input.organizationId,
    guildId: input.guildId,
    roleId: input.roleId,
    customerId: input.customerId,
    entitlementId: input.entitlementId,
    discordUserId: input.discordUserId,
    createdAt: toIso(now),
  };

  try {
    await api.addRole({
      guildId: input.guildId,
      userId: input.discordUserId,
      roleId: input.roleId,
    });
    return { ...base, status: "active" };
  } catch (error) {
    // Normalize for logging context; the caller persists the failed attempt.
    void toDiscordTransportError(error, "discord.grantDiscordRole");
    return { ...base, status: "failed" };
  }
}

/**
 * Grant a role, propagating any failure as a thrown SettleKitError instead of
 * returning a `failed` grant. Use when the caller wants strict success/failure
 * semantics rather than a persisted attempt record.
 */
export async function grantDiscordRoleStrict(
  api: DiscordApi,
  input: GrantDiscordRoleInput,
  now: Date = new Date(),
): Promise<DiscordRoleGrant> {
  await api.addRole({
    guildId: input.guildId,
    userId: input.discordUserId,
    roleId: input.roleId,
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
    createdAt: toIso(now),
  };
}
