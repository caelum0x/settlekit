/**
 * GitHub delivery retry.
 *
 * The hosted checkout grants GitHub access right after a payment confirms.
 * When the merchant's GitHub App was not configured yet (or GitHub failed)
 * the entitlement is stored as `pending` and the buyer sees "pending setup"
 * — nothing retried it. This job does: for every PENDING GitHub entitlement
 * granted by a CONFIRMED payment, it invites the buyer (repo collaborator or
 * org team member) through the worker's real GitHub App client and flips the
 * entitlement to `active`. It never fabricates access:
 *
 *   - it only runs once a GitHub App installation id is configured
 *     (GITHUB_INSTALLATION_ID or GITHUB_APP_INSTALLATION_ID);
 *   - payments with a queued delivery run are left to the delivery runner;
 *   - the target repo/team comes from the entitlement or the product
 *     metadata, the username from the checkout session — never guessed;
 *   - failures back off exponentially per entitlement (5 min doubling to
 *     6 h) so a bad username or missing repo does not hammer GitHub.
 */

import type { Entitlement, Payment, Product } from "@settlekit/common";
import { errorMessage } from "../logger.js";
import type { Job, JobContext, JobResult } from "./types.js";

export const GITHUB_ENTITLEMENT_TYPES: ReadonlySet<Entitlement["entitlementType"]> = new Set([
  "github_repo_access",
  "github_team_access",
]);
export const RETRY_BASE_MS = 5 * 60_000;
export const RETRY_MAX_MS = 6 * 60 * 60_000;
/** Bound the GitHub calls one tick can make. */
export const MAX_PER_TICK = 25;

type Permission = "pull" | "push" | "maintain";
const PERMISSIONS: ReadonlySet<string> = new Set(["pull", "push", "maintain"]);

interface Backoff {
  attempts: number;
  nextAt: number;
}

type Target =
  | { kind: "repo"; owner: string; repo: string; permission: Permission }
  | { kind: "team"; orgLogin: string; teamSlug: string };

type Attempt =
  | { status: "delivered"; resourceId: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

function meta(product: Product | undefined, key: string): string | undefined {
  const value = product?.metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function splitPair(value: string | undefined): [string, string] | undefined {
  const [first, second, extra] = (value ?? "").split("/");
  return first && second && extra === undefined ? [first, second] : undefined;
}

/** Resolve where access goes (same rules as the checkout's delivery). */
export function resolveGitHubTarget(entitlement: Entitlement, product: Product | undefined): Target | undefined {
  if (entitlement.entitlementType === "github_team_access") {
    const pair = splitPair(entitlement.resourceId);
    const orgLogin = pair?.[0] ?? meta(product, "orgLogin");
    const teamSlug = pair?.[1] ?? meta(product, "teamSlug");
    return orgLogin && teamSlug ? { kind: "team", orgLogin, teamSlug } : undefined;
  }
  const rawPermission = meta(product, "permission");
  const permission: Permission = rawPermission && PERMISSIONS.has(rawPermission) ? (rawPermission as Permission) : "pull";
  const pair = splitPair(entitlement.resourceId) ?? splitPair(meta(product, "repoId"));
  if (pair) return { kind: "repo", owner: pair[0], repo: pair[1], permission };
  const owner = meta(product, "repoOwner");
  const repo = meta(product, "repoName") ?? entitlement.resourceId;
  return owner && repo && !repo.includes("/") ? { kind: "repo", owner, repo, permission } : undefined;
}

async function confirmedPayment(ctx: JobContext, entitlement: Entitlement): Promise<Payment | undefined> {
  const payment = await ctx.stores.getPayment(entitlement.grantedBy.id);
  return payment?.status === "confirmed" ? payment : undefined;
}

async function attempt(ctx: JobContext, entitlement: Entitlement): Promise<Attempt> {
  const payment = await confirmedPayment(ctx, entitlement);
  if (!payment) return { status: "skipped", reason: "payment is not confirmed" };
  if (await ctx.stores.deliveryRunByPayment(payment.id)) {
    return { status: "skipped", reason: "the delivery runner owns this payment" };
  }
  const session = await ctx.stores.getCheckoutSession(payment.checkoutSessionId);
  const username = session?.collectedFields.githubUsername?.trim();
  if (!username) return { status: "failed", reason: "no GitHub username was collected at checkout" };
  const target = resolveGitHubTarget(entitlement, await ctx.stores.getProduct(entitlement.productId));
  if (!target) return { status: "failed", reason: "the product has no GitHub repository or team configured" };

  const common = {
    organizationId: entitlement.organizationId,
    customerId: entitlement.customerId,
    entitlementId: entitlement.id,
    installationId: ctx.config.github.installationId,
    githubUsername: username,
  };
  if (target.kind === "team") {
    await ctx.clients.github.addTeamMembership({ ...common, orgLogin: target.orgLogin, teamSlug: target.teamSlug });
    return { status: "delivered", resourceId: `${target.orgLogin}/${target.teamSlug}` };
  }
  await ctx.clients.github.inviteCollaborator({
    ...common,
    repoOwner: target.owner,
    repoName: target.repo,
    permission: target.permission,
  });
  return { status: "delivered", resourceId: `${target.owner}/${target.repo}` };
}

function isRetryCandidate(entitlement: Entitlement): boolean {
  return (
    entitlement.status === "pending" &&
    entitlement.grantedBy.type === "payment" &&
    GITHUB_ENTITLEMENT_TYPES.has(entitlement.entitlementType)
  );
}

/** Build the job with its own backoff ledger (tests get a fresh one). */
export function createGithubDeliveryRetryJob(backoff: Map<string, Backoff> = new Map()): Job {
  return {
    name: "github-delivery-retry",
    async run(ctx: JobContext): Promise<JobResult> {
      if (!ctx.config.github.installationConfigured) return { processed: 0, failed: 0 };
      const now = ctx.now();
      const due = (await ctx.stores.allEntitlements())
        .filter(isRetryCandidate)
        .filter((entitlement) => (backoff.get(entitlement.id)?.nextAt ?? 0) <= now.getTime())
        .slice(0, MAX_PER_TICK);

      let processed = 0;
      let failed = 0;
      for (const entitlement of due) {
        let outcome: Attempt;
        try {
          outcome = await attempt(ctx, entitlement);
        } catch (error) {
          outcome = { status: "failed", reason: errorMessage(error) };
        }
        if (outcome.status === "skipped") continue;
        if (outcome.status === "delivered") {
          await ctx.stores.upsertEntitlement({
            ...entitlement,
            status: "active",
            resourceId: outcome.resourceId,
            updatedAt: now.toISOString(),
          });
          backoff.delete(entitlement.id);
          processed += 1;
          ctx.logger.info("github access delivered on retry", { entitlementId: entitlement.id, target: outcome.resourceId });
          continue;
        }
        const attempts = (backoff.get(entitlement.id)?.attempts ?? 0) + 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
        backoff.set(entitlement.id, { attempts, nextAt: now.getTime() + delay });
        failed += 1;
        ctx.logger.warn("github delivery retry failed", {
          entitlementId: entitlement.id,
          attempts,
          retryInMs: delay,
          reason: outcome.reason,
        });
      }
      return { processed, failed };
    },
  };
}

export const githubDeliveryRetryJob: Job = createGithubDeliveryRetryJob();
