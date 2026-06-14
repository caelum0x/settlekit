export interface DiscordRoleSummary {
  id: string;
  name: string;
  managed: boolean;
}

export function selectableDiscordRoles(roles: DiscordRoleSummary[]): DiscordRoleSummary[] {
  return roles.filter((role) => !role.managed);
}
