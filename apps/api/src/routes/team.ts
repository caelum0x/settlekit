/**
 * Team: members with roles and email invitations.
 *
 *   GET    /v1/team                        members + invitations
 *   POST   /v1/team/invitations            invite by email with a role
 *   POST   /v1/team/invitations/:id/revoke revoke a pending invitation
 *   PATCH  /v1/team/members/:accountId     change a member's role
 *   DELETE /v1/team/members/:accountId     remove a member
 *
 * Roles map to management scopes (see @settlekit/api-keys scopesForRole):
 * owner and admin have full access, developer builds (products, checkout,
 * webhooks, API keys), support handles customers and payments, viewer reads.
 * Only an owner can grant or change the owner role, and the last owner cannot
 * be removed or demoted. Invitations are accepted at
 * POST /v1/auth/invitations/accept (the emailed link).
 */
import { createHash } from "node:crypto";
import { Hono, type Context } from "hono";
import { z } from "zod";
import { SettleKitError, conflict, generateSecret, notFound, validationError } from "@settlekit/common";
import { TEAM_ROLES } from "@settlekit/api-keys";
import { createInvitation, isInvitationOpen, revokeInvitation, type InvitationRole } from "@settlekit/invitations";
import type { TeamInvitation, TeamMember, TeamSettings } from "@settlekit/persistence";
import type { AppContext, AppEnv } from "../context.js";
import { created, data } from "../http/respond.js";
import { parseBody } from "../http/validate.js";
import { requireOrg } from "../http/tenant.js";

const roleEnum = z.enum(TEAM_ROLES);

const inviteSchema = z.object({ email: z.string().trim().email(), role: roleEnum });
const roleSchema = z.object({ role: roleEnum });

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Invite tokens carry the org id so acceptance can find the invitation. */
export function inviteToken(organizationId: string): string {
  return `${organizationId}.${generateSecret(24)}`;
}

export function dashboardBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.DASHBOARD_PUBLIC_URL ?? env.NEXT_PUBLIC_DASHBOARD_URL ?? "http://localhost:3001").replace(/\/+$/, "");
}

export async function loadTeam(ctx: AppContext, organizationId: string): Promise<TeamSettings> {
  const settings = await ctx.orgSettings.get(organizationId);
  return { members: [...(settings.team?.members ?? [])], invitations: [...(settings.team?.invitations ?? [])] };
}

export async function saveTeam(ctx: AppContext, organizationId: string, team: TeamSettings): Promise<void> {
  await ctx.orgSettings.update(organizationId, { team });
}

/** The caller's role: a session's role, or owner for API keys / bootstrap. */
function callerRole(c: Context<AppEnv>): string {
  return c.get("teamRole") ?? "owner";
}

/** Make sure the org's creator appears as owner once someone opens the team page. */
async function withCreator(c: Context<AppEnv>, team: TeamSettings): Promise<TeamSettings> {
  const apiKeyId = c.get("apiKeyId") ?? "";
  if (!apiKeyId.startsWith("session:") || c.get("teamRole") !== "owner") return team;
  const accountId = apiKeyId.slice("session:".length);
  if (team.members.some((m) => m.accountId === accountId)) return team;
  const account = await c.get("ctx").auth.findAccountById(accountId);
  if (!account) return team;
  const creator: TeamMember = { accountId, email: account.email, role: "owner", joinedAt: account.createdAt };
  const next = { ...team, members: [creator, ...team.members] };
  await saveTeam(c.get("ctx"), requireOrg(c), next);
  return next;
}

function publicInvitation(inv: TeamInvitation) {
  const { tokenHash: _h, ...rest } = inv;
  void _h;
  return rest;
}

function assertCanGrant(c: Context<AppEnv>, role: string): void {
  if (role === "owner" && callerRole(c) !== "owner") {
    throw new SettleKitError({ code: "forbidden", message: "Only an owner can grant the owner role" });
  }
}

function ownersAfter(team: TeamSettings, accountId: string, nextRole: string | null): number {
  return team.members.filter((m) => (m.accountId === accountId ? nextRole === "owner" : m.role === "owner")).length;
}

export function teamRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const team = await withCreator(c, await loadTeam(ctx, org));
    const now = new Date();
    return data(c, {
      members: team.members,
      invitations: team.invitations
        .map((inv) => (inv.status === "pending" && !isInvitationOpen(inv, now) ? { ...inv, status: "expired" as const } : inv))
        .filter((inv) => inv.status === "pending" || inv.status === "expired")
        .map(publicInvitation),
      roles: TEAM_ROLES,
    });
  });

  app.post("/invitations", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const body = await parseBody(c, inviteSchema);
    assertCanGrant(c, body.role);
    const team = await withCreator(c, await loadTeam(ctx, org));
    const email = body.email.toLowerCase();
    if (team.members.some((m) => m.email.toLowerCase() === email)) throw conflict("This person is already on the team");
    const existing = await ctx.auth.findAccountByEmail(email);
    if (existing?.organizationId && existing.organizationId !== org) {
      throw conflict("This email already belongs to another SettleKit organization");
    }
    const token = inviteToken(org);
    const base = createInvitation({ email, role: body.role, token });
    const now = new Date().toISOString();
    const invitation: TeamInvitation = {
      id: `inv_team_${generateSecret(9)}`,
      email: base.email,
      role: base.role,
      tokenHash: hashInviteToken(token),
      status: base.status,
      expiresAt: base.expiresAt,
      invitedBy: c.get("apiKeyId") ?? "unknown",
      createdAt: now,
    };
    // One open invitation per email: a new one replaces the old.
    const others = team.invitations.map((inv) =>
      inv.email === email && inv.status === "pending" ? { ...inv, status: "revoked" as const } : inv,
    );
    await saveTeam(ctx, org, { ...team, invitations: [...others, invitation] });

    const inviteUrl = `${dashboardBaseUrl()}/invite/${encodeURIComponent(token)}`;
    let emailed = false;
    if (ctx.email) {
      const settings = await ctx.orgSettings.get(org);
      try {
        await ctx.email.send({
          to: email,
          subject: `You are invited to ${settings.orgName} on SettleKit`,
          text: `You were invited to join ${settings.orgName} on SettleKit as ${body.role}.\n\nAccept: ${inviteUrl}\n\nThe link expires in 7 days.`,
          html: `<p>You were invited to join <strong>${settings.orgName.replace(/[<>&"]/g, "")}</strong> on SettleKit as ${body.role}.</p><p><a href="${inviteUrl}">Accept the invitation</a></p><p>The link expires in 7 days.</p>`,
          tags: [{ name: "type", value: "team_invite" }],
        });
        emailed = true;
      } catch {
        emailed = false;
      }
    }
    return created(c, { invitation: publicInvitation(invitation), inviteUrl, emailed });
  });

  app.post("/invitations/:id/revoke", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const team = await loadTeam(ctx, org);
    const target = team.invitations.find((inv) => inv.id === c.req.param("id"));
    if (!target) throw notFound("invitation not found");
    const closed = revokeInvitation({ email: target.email, role: target.role as InvitationRole, token: "", status: target.status, expiresAt: target.expiresAt });
    const revoked = { ...target, status: closed.status };
    await saveTeam(ctx, org, { ...team, invitations: team.invitations.map((inv) => (inv.id === target.id ? revoked : inv)) });
    return data(c, publicInvitation(revoked));
  });

  app.patch("/members/:accountId", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const accountId = c.req.param("accountId");
    const body = await parseBody(c, roleSchema);
    const team = await withCreator(c, await loadTeam(ctx, org));
    const member = team.members.find((m) => m.accountId === accountId);
    if (!member) throw notFound("member not found");
    assertCanGrant(c, body.role);
    if (member.role === "owner") assertCanGrant(c, "owner");
    if (ownersAfter(team, accountId, body.role) === 0) throw validationError("The team needs at least one owner");
    unwrap(await ctx.auth.assignOrganization(accountId, org, body.role));
    const next = { ...member, role: body.role };
    await saveTeam(ctx, org, { ...team, members: team.members.map((m) => (m.accountId === accountId ? next : m)) });
    return data(c, next);
  });

  app.delete("/members/:accountId", async (c) => {
    const ctx = c.get("ctx");
    const org = requireOrg(c);
    const accountId = c.req.param("accountId");
    const team = await withCreator(c, await loadTeam(ctx, org));
    const member = team.members.find((m) => m.accountId === accountId);
    if (!member) throw notFound("member not found");
    if (member.role === "owner") assertCanGrant(c, "owner");
    if (ownersAfter(team, accountId, null) === 0) throw validationError("The team needs at least one owner");
    unwrap(await ctx.auth.assignOrganization(accountId, undefined));
    await saveTeam(ctx, org, { ...team, members: team.members.filter((m) => m.accountId !== accountId) });
    return data(c, { removed: accountId });
  });

  return app;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: SettleKitError }): T {
  if (!result.ok) throw result.error;
  return result.value;
}
