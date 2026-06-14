export interface DiscordAccessClient {
  addGuildMemberRole(input: { guildId: string; roleId: string; discordUserId: string }): Promise<void>;
  removeGuildMemberRole(input: { guildId: string; roleId: string; discordUserId: string }): Promise<void>;
  hasGuildMemberRole(input: { guildId: string; roleId: string; discordUserId: string }): Promise<boolean>;
}

export interface GrantDiscordRoleInput {
  organizationId: string;
  guildId: string;
  roleId: string;
  customerId: string;
  entitlementId: string;
  discordUserId: string;
}
