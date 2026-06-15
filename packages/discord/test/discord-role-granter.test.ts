import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { grantDiscordRole, grantDiscordRoleStrict, type GrantDiscordRoleInput } from "../src/index.js";
import { InMemoryDiscordApi } from "./in-memory-discord-api.js";

const input: GrantDiscordRoleInput = {
  organizationId: "org_1",
  guildId: "guild_1",
  roleId: "role_1",
  customerId: "cus_1",
  entitlementId: "ent_1",
  discordUserId: "user_1",
};

describe("grantDiscordRole", () => {
  it("adds the role to the member and returns an active grant", async () => {
    const api = new InMemoryDiscordApi();
    const grant = await grantDiscordRole(api, input, new Date("2026-01-01T00:00:00.000Z"));

    expect(grant.status).toBe("active");
    expect(grant.guildId).toBe("guild_1");
    expect(grant.roleId).toBe("role_1");
    expect(grant.discordUserId).toBe("user_1");
    expect(grant.entitlementId).toBe("ent_1");
    expect(grant.id.startsWith("dra_")).toBe(true);
    expect(grant.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(api.has({ guildId: "guild_1", userId: "user_1", roleId: "role_1" })).toBe(true);
  });

  it("returns a failed grant (no throw) when Discord rejects the call", async () => {
    const api = new InMemoryDiscordApi();
    api.failNext = new SettleKitError({ code: "forbidden", message: "Missing Permissions" });

    const grant = await grantDiscordRole(api, input);

    expect(grant.status).toBe("failed");
    expect(api.has({ guildId: "guild_1", userId: "user_1", roleId: "role_1" })).toBe(false);
  });
});

describe("grantDiscordRoleStrict", () => {
  it("throws the normalized SettleKitError on failure", async () => {
    const api = new InMemoryDiscordApi();
    api.failNext = new SettleKitError({ code: "rate_limited", message: "Too Many Requests" });

    await expect(grantDiscordRoleStrict(api, input)).rejects.toBeInstanceOf(SettleKitError);
  });

  it("returns an active grant on success", async () => {
    const api = new InMemoryDiscordApi();
    const grant = await grantDiscordRoleStrict(api, input);
    expect(grant.status).toBe("active");
  });
});
