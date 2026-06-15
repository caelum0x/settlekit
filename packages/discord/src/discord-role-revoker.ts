import { conflict, toIso, type DiscordRoleGrant } from "@settlekit/common";
import type { DiscordApi } from "./types.js";

/**
 * Revoke a previously-granted Discord role by calling
 * `DELETE /guilds/{guild}/members/{user}/roles/{role}`, returning a new grant
 * marked `revoked`. The input grant is never mutated.
 */
export async function revokeDiscordRole(
  api: DiscordApi,
  grant: DiscordRoleGrant,
  now: Date = new Date(),
): Promise<DiscordRoleGrant> {
  if (grant.status === "revoked") {
    return grant;
  }
  await api.removeRole({
    guildId: grant.guildId,
    userId: grant.discordUserId,
    roleId: grant.roleId,
  });
  return markDiscordRoleRevoked(grant, now);
}

/** Produce a `revoked` copy of a grant without performing any I/O. */
export function markDiscordRoleRevoked(
  grant: DiscordRoleGrant,
  now: Date = new Date(),
): DiscordRoleGrant {
  return { ...grant, status: "revoked", revokedAt: toIso(now) };
}

/**
 * Revoke a grant whose backing entitlement has expired. The `expiresAt`
 * timestamp is the entitlement's expiry; revocation is refused (with a
 * `conflict` SettleKitError) when the entitlement has not yet expired.
 */
export async function revokeOnExpiry(
  api: DiscordApi,
  grant: DiscordRoleGrant,
  expiresAt: string,
  now: Date = new Date(),
): Promise<DiscordRoleGrant> {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) {
    throw conflict("revokeOnExpiry: invalid expiresAt timestamp", {
      grantId: grant.id,
      expiresAt,
    });
  }
  if (expiry > now.getTime()) {
    throw conflict("revokeOnExpiry: entitlement has not expired yet", {
      grantId: grant.id,
      expiresAt,
    });
  }
  return revokeDiscordRole(api, grant, now);
}
