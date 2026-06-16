/**
 * Discord integration routes (plan §26).
 *
 * Connect a guild, list guilds/roles (via the REAL `@settlekit/discord`
 * `listGuilds` / `listGuildRoles` against an in-process `DiscordApi`), and
 * grant/revoke paid roles via `grantDiscordRole` / `revokeDiscordRole`.
 *
 * Mounted twice:
 *   - integrationRoutes() under /v1/integrations/discord (connect/guilds/roles)
 *   - accessRoutes()      under /v1/discord/access       (grant/revoke)
 */
import { Hono } from "hono";
import { z } from "zod";
import { generateId, notFound, type DiscordConnection } from "@settlekit/common";
import {
  listGuilds,
  toGuildSummaries,
  listGuildRoles,
  assignableRoles,
  grantDiscordRole,
  revokeDiscordRole,
} from "@settlekit/discord";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const connectSchema = z.object({
  organizationId: z.string().min(1),
  guildId: z.string().min(1),
  guildName: z.string().min(1),
  botTokenRef: z.string().min(1),
});

const grantSchema = z.object({
  organizationId: z.string().min(1),
  guildId: z.string().min(1),
  roleId: z.string().min(1),
  customerId: z.string().min(1),
  entitlementId: z.string().min(1),
  discordUserId: z.string().min(1),
});

const revokeSchema = z.object({
  grantId: z.string().min(1),
});

/** /v1/integrations/discord — connect, guilds, roles. */
export function discordIntegrationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/connect", async (c) => {
    const body = await parseBody(c, connectSchema);
    const connection: DiscordConnection = {
      id: generateId("discordRoleAccess"),
      organizationId: body.organizationId,
      guildId: body.guildId,
      guildName: body.guildName,
      botTokenRef: body.botTokenRef,
      createdAt: new Date().toISOString(),
    };
    return created(c, await c.get("ctx").discordConnections.save(connection));
  });

  app.get("/guilds", async (c) => {
    const guilds = await listGuilds(c.get("ctx").discordApi);
    return data(c, toGuildSummaries(guilds));
  });

  app.get("/roles", async (c) => {
    const guildId = c.req.query("guildId");
    if (!guildId) throw notFound("guildId query param is required");
    const roles = await listGuildRoles(c.get("ctx").discordApi, guildId);
    return data(c, assignableRoles(roles, guildId));
  });

  return app;
}

/** /v1/discord/access — grant / revoke. */
export function discordAccessRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // List all Discord role grants.
  app.get("/", async (c) => {
    return data(c, await c.get("ctx").discordGrants.list());
  });

  app.post("/grant", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, grantSchema);
    const grant = await grantDiscordRole(ctx.discordApi, {
      organizationId: body.organizationId,
      guildId: body.guildId,
      roleId: body.roleId,
      customerId: body.customerId,
      entitlementId: body.entitlementId,
      discordUserId: body.discordUserId,
    });
    return created(c, await ctx.discordGrants.save(grant));
  });

  app.post("/revoke", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, revokeSchema);
    const grant = await ctx.discordGrants.findById(body.grantId);
    if (!grant) throw notFound("discord grant not found", { id: body.grantId });
    const revoked = await revokeDiscordRole(ctx.discordApi, grant);
    return data(c, await ctx.discordGrants.save(revoked));
  });

  return app;
}
