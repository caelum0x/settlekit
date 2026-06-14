import { describe, expect, it } from "vitest";
import type { DiscordRoleGrant } from "@settlekit/common";
import { markDiscordRoleRevoked } from "../src/index.js";

describe("markDiscordRoleRevoked", () => {
  it("marks a grant revoked", () => {
    const grant = {
      id: "dra_1",
      organizationId: "org_1",
      guildId: "guild_1",
      roleId: "role_1",
      customerId: "cus_1",
      entitlementId: "ent_1",
      discordUserId: "user_1",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies DiscordRoleGrant;
    expect(markDiscordRoleRevoked(grant).status).toBe("revoked");
  });
});
