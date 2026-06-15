/**
 * Access synchronization job.
 *
 * Periodically reconciles externally-granted access against the entitlements
 * that should currently be active:
 *  1. Computes which entitlements have expired (`@settlekit/entitlements`
 *     `expireDue`) and persists their `expired` status.
 *  2. Reconciles GitHub repo access with the real `syncAccess`, revoking grants
 *     whose entitlement has expired and re-inviting any that drifted.
 *  3. Reconciles Discord roles with the real `syncDiscordAccess`, granting the
 *     desired set and revoking roles no longer entitled.
 */

import { expireDue, expire } from "@settlekit/entitlements";
import {
  createGitHubAccessClient,
  syncAccess,
  type ExpectedRepoAccess,
} from "@settlekit/github";
import { syncDiscordAccess, type GrantDiscordRoleInput } from "@settlekit/discord";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const accessSyncJob: Job = {
  name: "access-sync",
  async run(ctx: JobContext): Promise<JobResult> {
    const now = ctx.now();
    let processed = 0;
    let failed = 0;

    // 1. Expire entitlements whose window has elapsed.
    const entitlements = await ctx.stores.allEntitlements();
    const due = expireDue(entitlements, now);
    const expiredIds = new Set(due.map((e) => e.id));
    for (const entitlement of due) {
      await ctx.stores.upsertEntitlement(expire(entitlement, now));
      processed += 1;
    }

    // 2. GitHub repo access reconciliation.
    try {
      const githubClient = createGitHubAccessClient(ctx.githubApi);
      const githubGrants = await ctx.stores.allGithubGrants();
      const expected: ExpectedRepoAccess[] = githubGrants
        .filter((g) => g.status !== "revoked")
        .map((grant) => ({
          grant,
          expired: expiredIds.has(grant.entitlementId),
        }));

      if (expected.length > 0) {
        const run = await syncAccess(githubClient, expected, now);
        for (const outcome of run.outcomes) {
          if (outcome.grant) await ctx.stores.upsertGithubGrant(outcome.grant);
        }
        processed += run.total;
        failed += run.failed;
        ctx.logger.info("github access synced", {
          total: run.total,
          activated: run.activated,
          revoked: run.revoked,
          failed: run.failed,
        });
      }
    } catch (error) {
      failed += 1;
      ctx.logger.error("github access sync failed", { error: errorMessage(error) });
    }

    // 3. Discord role reconciliation.
    try {
      const grants = await ctx.stores.allDiscordGrants();
      const desired: GrantDiscordRoleInput[] = grants
        .filter((g) => g.status === "active" && !expiredIds.has(g.entitlementId))
        .map((g) => ({
          organizationId: g.organizationId,
          guildId: g.guildId,
          roleId: g.roleId,
          customerId: g.customerId,
          entitlementId: g.entitlementId,
          discordUserId: g.discordUserId,
        }));

      const result = await syncDiscordAccess(ctx.discordApi, desired, grants, now);
      for (const grant of [...result.granted, ...result.revoked]) {
        await ctx.stores.upsertDiscordGrant(grant);
      }
      processed += result.granted.length + result.revoked.length;
      ctx.logger.info("discord access synced", {
        granted: result.granted.length,
        revoked: result.revoked.length,
        unchanged: result.unchanged.length,
      });
    } catch (error) {
      failed += 1;
      ctx.logger.error("discord access sync failed", { error: errorMessage(error) });
    }

    return { processed, failed };
  },
};
