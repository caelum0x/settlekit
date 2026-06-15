import { notFound } from "@settlekit/common";
import type { DiscordApi, DiscordRole } from "./types.js";

/** A compact view of a role for selection UIs. */
export interface DiscordRoleSummary {
  id: string;
  name: string;
  /** True when the role is managed by an integration/bot and not assignable. */
  managed: boolean;
  position: number;
}

/** Fetch the roles in a guild via `GET /guilds/{guildId}/roles`. */
export async function listGuildRoles(api: DiscordApi, guildId: string): Promise<DiscordRole[]> {
  return api.listGuildRoles(guildId);
}

/**
 * Roles that can be granted to members: excludes the implicit `@everyone` role
 * (whose id equals the guild id) and integration-managed roles.
 */
export function assignableRoles(roles: readonly DiscordRole[], guildId: string): DiscordRoleSummary[] {
  return roles
    .filter((role) => role.id !== guildId && !role.managed)
    .map((role) => ({
      id: role.id,
      name: role.name,
      managed: role.managed ?? false,
      position: role.position ?? 0,
    }))
    .sort((a, b) => b.position - a.position);
}

/** Find a role by id, throwing a `not_found` SettleKitError when absent. */
export async function requireRole(
  api: DiscordApi,
  guildId: string,
  roleId: string,
): Promise<DiscordRole> {
  const roles = await api.listGuildRoles(guildId);
  const role = roles.find((candidate) => candidate.id === roleId);
  if (!role) {
    throw notFound(`Discord role ${roleId} not found in guild ${guildId}`, { guildId, roleId });
  }
  return role;
}
