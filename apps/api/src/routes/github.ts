/**
 * GitHub integration routes (plan §26).
 *
 * Installations / repositories / teams are persisted as records; access
 * grant/revoke/sync drive the REAL `@settlekit/github` domain functions
 * (`grantGitHubRepoAccess`, `revokeGitHubRepoAccess`, `markGitHubGrantRevoked`)
 * against an in-process `GitHubAccessClient` so the flow runs end to end.
 *
 * Mounted twice by the app:
 *   - integrationRoutes() under /v1/integrations/github (installations/repos/teams)
 *   - accessRoutes()      under /v1/github/access       (grant/revoke/sync)
 */
import { Hono } from "hono";
import { z } from "zod";
import { generateId, notFound, validationError, type GitHubInstallation } from "@settlekit/common";
import {
  grantGitHubRepoAccess,
  revokeGitHubRepoAccess,
  markGitHubGrantRevoked,
  formatRepositoryName,
} from "@settlekit/github";
import type { AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";

const installSchema = z.object({
  organizationId: z.string().min(1),
  installationId: z.number().int().positive(),
  accountLogin: z.string().min(1),
  accountType: z.enum(["User", "Organization"]),
});

const grantSchema = z.object({
  organizationId: z.string().min(1),
  installationId: z.number().int().positive(),
  customerId: z.string().min(1),
  entitlementId: z.string().min(1),
  repoOwner: z.string().min(1),
  repoName: z.string().min(1),
  githubUsername: z.string().min(1),
  permission: z.enum(["pull", "push", "maintain"]).optional(),
});

const revokeSchema = z.object({
  grantId: z.string().min(1),
});

/** /v1/integrations/github — installations, repositories, teams. */
export function githubIntegrationRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Connect a GitHub App installation.
  app.post("/installations", async (c) => {
    const body = await parseBody(c, installSchema);
    const installation: GitHubInstallation = {
      id: generateId("githubInstallation"),
      organizationId: body.organizationId,
      installationId: body.installationId,
      accountLogin: body.accountLogin,
      accountType: body.accountType,
      createdAt: new Date().toISOString(),
    };
    return created(c, await c.get("ctx").githubInstallations.save(installation));
  });

  app.get("/installations", async (c) => {
    const orgId = c.req.query("organizationId");
    return data(
      c,
      await c.get("ctx").githubInstallations.list(
        orgId ? (i) => i.organizationId === orgId : undefined,
      ),
    );
  });

  // Repositories visible to an installation (derived from recorded grants).
  app.get("/repositories", async (c) => {
    const ctx = c.get("ctx");
    const repos = (await ctx.githubGrants.list())
      .map((g) => ({
        owner: g.repoOwner,
        name: g.repoName,
        fullName: formatRepositoryName({ owner: g.repoOwner, name: g.repoName }),
      }));
    // De-duplicate by full name.
    const seen = new Map<string, (typeof repos)[number]>();
    for (const r of repos) seen.set(r.fullName, r);
    return data(c, [...seen.values()]);
  });

  // Org teams (synthesized from team-style grants / installations).
  app.get("/teams", async (c) => {
    const orgId = c.req.query("organizationId");
    const installs = await c.get("ctx").githubInstallations.list(
      orgId ? (i) => i.organizationId === orgId : undefined,
    );
    const teams = installs
      .filter((i) => i.accountType === "Organization")
      .map((i) => ({ orgLogin: i.accountLogin, slug: "members", name: `${i.accountLogin}/members` }));
    return data(c, teams);
  });

  return app;
}

/** /v1/github/access — grant / revoke / sync. */
export function githubAccessRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Grant a customer access to a private repo (real granter + in-process client).
  app.post("/grant", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, grantSchema);
    const grant = await grantGitHubRepoAccess(ctx.githubClient, {
      organizationId: body.organizationId,
      installationId: body.installationId,
      customerId: body.customerId,
      entitlementId: body.entitlementId,
      repoOwner: body.repoOwner,
      repoName: body.repoName,
      githubUsername: body.githubUsername,
      ...(body.permission !== undefined ? { permission: body.permission } : {}),
    });
    return created(c, await ctx.githubGrants.save(grant));
  });

  // Revoke a recorded grant (real revoker + marks the record revoked).
  app.post("/revoke", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(c, revokeSchema);
    const grant = await ctx.githubGrants.findById(body.grantId);
    if (!grant) throw notFound("github grant not found", { id: body.grantId });
    await revokeGitHubRepoAccess(ctx.githubClient, {
      installationId: grant.installationId,
      repoOwner: grant.repoOwner,
      repoName: grant.repoName,
      githubUsername: grant.githubUsername,
    });
    return data(c, await ctx.githubGrants.save(markGitHubGrantRevoked(grant)));
  });

  // Sync: reconcile recorded grants by promoting pending invites that the
  // in-process client now reports as accepted (permission != "none").
  app.post("/sync", async (c) => {
    const ctx = c.get("ctx");
    const body = await parseBody(
      c,
      z.object({ organizationId: z.string().min(1) }),
    );
    if (body.organizationId.length === 0) {
      throw validationError("organizationId is required");
    }
    const outcomes: Array<{ grantId: string; action: string }> = [];
    for (const grant of await ctx.githubGrants.list((g) => g.organizationId === body.organizationId)) {
      if (grant.status !== "invited") continue;
      const permission = await ctx.githubClient.getRepoCollaboratorPermission({
        installationId: grant.installationId,
        owner: grant.repoOwner,
        repo: grant.repoName,
        username: grant.githubUsername,
      });
      if (permission !== "none") {
        await ctx.githubGrants.save({ ...grant, status: "active" });
        outcomes.push({ grantId: grant.id, action: "activated" });
      } else {
        outcomes.push({ grantId: grant.id, action: "noop" });
      }
    }
    return data(c, { organizationId: body.organizationId, outcomes });
  });

  return app;
}
