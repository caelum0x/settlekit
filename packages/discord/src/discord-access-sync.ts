import type { DiscordRoleGrant } from "@settlekit/common";
import type { DiscordApi, GrantDiscordRoleInput } from "./types.js";
import { grantDiscordRole } from "./discord-role-granter.js";
import { revokeDiscordRole } from "./discord-role-revoker.js";

/** The outcome of reconciling desired access against existing grants. */
export interface DiscordAccessSyncResult {
  /** Grants created for newly-entitled members. */
  granted: DiscordRoleGrant[];
  /** Grants revoked for members no longer entitled. */
  revoked: DiscordRoleGrant[];
  /** Grants left untouched because they were already in the desired state. */
  unchanged: DiscordRoleGrant[];
}

function grantKey(guildId: string, roleId: string, discordUserId: string): string {
  return `${guildId}:${roleId}:${discordUserId}`;
}

function desiredKey(input: GrantDiscordRoleInput): string {
  return grantKey(input.guildId, input.roleId, input.discordUserId);
}

/**
 * Reconcile Discord role membership so that exactly the `desired` set of
 * entitlements is active.
 *
 * - desired entries with no matching active grant are granted;
 * - active grants with no matching desired entry are revoked;
 * - active grants that are still desired are left unchanged.
 *
 * `existing` should be the currently-active grants for the same guild/role
 * scope. Non-active grants (`revoked`/`failed`) are ignored as existing state.
 */
export async function syncDiscordAccess(
  api: DiscordApi,
  desired: readonly GrantDiscordRoleInput[],
  existing: readonly DiscordRoleGrant[],
  now: Date = new Date(),
): Promise<DiscordAccessSyncResult> {
  const desiredByKey = new Map<string, GrantDiscordRoleInput>();
  for (const input of desired) desiredByKey.set(desiredKey(input), input);

  const activeExisting = existing.filter((grant) => grant.status === "active");
  const existingByKey = new Map<string, DiscordRoleGrant>();
  for (const grant of activeExisting) {
    existingByKey.set(grantKey(grant.guildId, grant.roleId, grant.discordUserId), grant);
  }

  const granted: DiscordRoleGrant[] = [];
  const unchanged: DiscordRoleGrant[] = [];
  for (const [key, input] of desiredByKey) {
    const current = existingByKey.get(key);
    if (current) {
      unchanged.push(current);
      continue;
    }
    granted.push(await grantDiscordRole(api, input, now));
  }

  const revoked: DiscordRoleGrant[] = [];
  for (const [key, grant] of existingByKey) {
    if (desiredByKey.has(key)) continue;
    revoked.push(await revokeDiscordRole(api, grant, now));
  }

  return { granted, revoked, unchanged };
}
