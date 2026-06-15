import { describe, expect, it } from "vitest";
import { SettleKitError, type DiscordRoleGrant } from "@settlekit/common";
import { markDiscordRoleRevoked, revokeDiscordRole, revokeOnExpiry } from "../src/index.js";
import { InMemoryDiscordApi } from "./in-memory-discord-api.js";

function activeGrant(): DiscordRoleGrant {
  return {
    id: "dra_1",
    organizationId: "org_1",
    guildId: "guild_1",
    roleId: "role_1",
    customerId: "cus_1",
    entitlementId: "ent_1",
    discordUserId: "user_1",
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("markDiscordRoleRevoked", () => {
  it("marks a grant revoked without mutating the input", () => {
    const grant = activeGrant();
    const revoked = markDiscordRoleRevoked(grant, new Date("2026-02-01T00:00:00.000Z"));

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(grant.status).toBe("active");
  });
});

describe("revokeDiscordRole", () => {
  it("removes the role from the member and returns a revoked grant", async () => {
    const api = new InMemoryDiscordApi();
    await api.addRole({ guildId: "guild_1", userId: "user_1", roleId: "role_1" });

    const revoked = await revokeDiscordRole(api, activeGrant());

    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBeDefined();
    expect(api.has({ guildId: "guild_1", userId: "user_1", roleId: "role_1" })).toBe(false);
  });

  it("is idempotent for already-revoked grants", async () => {
    const api = new InMemoryDiscordApi();
    const already = markDiscordRoleRevoked(activeGrant());
    const result = await revokeDiscordRole(api, already);
    expect(result).toBe(already);
  });

  it("propagates a SettleKitError when Discord rejects removal", async () => {
    const api = new InMemoryDiscordApi();
    api.failNext = new SettleKitError({ code: "forbidden", message: "Missing Permissions" });
    await expect(revokeDiscordRole(api, activeGrant())).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("revokeOnExpiry", () => {
  it("revokes when the entitlement has expired", async () => {
    const api = new InMemoryDiscordApi();
    await api.addRole({ guildId: "guild_1", userId: "user_1", roleId: "role_1" });

    const revoked = await revokeOnExpiry(
      api,
      activeGrant(),
      "2026-01-15T00:00:00.000Z",
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(revoked.status).toBe("revoked");
    expect(api.has({ guildId: "guild_1", userId: "user_1", roleId: "role_1" })).toBe(false);
  });

  it("refuses to revoke before expiry with a conflict error", async () => {
    const api = new InMemoryDiscordApi();
    await expect(
      revokeOnExpiry(
        api,
        activeGrant(),
        "2026-12-31T00:00:00.000Z",
        new Date("2026-02-01T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects an invalid expiry timestamp", async () => {
    const api = new InMemoryDiscordApi();
    await expect(revokeOnExpiry(api, activeGrant(), "not-a-date")).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
