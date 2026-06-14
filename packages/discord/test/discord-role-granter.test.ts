import { describe, expect, it } from "vitest";
import { grantDiscordRole, type DiscordAccessClient } from "../src/index.js";

describe("grantDiscordRole", () => {
  it("adds a role and returns an active grant", async () => {
    const client: DiscordAccessClient = {
      async addGuildMemberRole() {},
      async removeGuildMemberRole() {},
      async hasGuildMemberRole() { return true; },
    };
    const grant = await grantDiscordRole(client, {
      organizationId: "org_1",
      guildId: "guild_1",
      roleId: "role_1",
      customerId: "cus_1",
      entitlementId: "ent_1",
      discordUserId: "user_1",
    });
    expect(grant.status).toBe("active");
  });
});
