import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { grantGitHubRepoAccess } from "./github-access-granter.js";
import { markGitHubGrantRevoked, revokeGitHubRepoAccess } from "./github-access-revoker.js";
import { toGitHubIntegrationError } from "./github-errors.js";
import type {
  ExpectedRepoAccess,
  GitHubAccessClient,
  GitHubAccessSyncOutcome,
  GitHubAccessSyncRun,
} from "./types.js";

/**
 * Reconcile a single grant against what GitHub actually reports. If GitHub shows
 * the collaborator with any permission the grant becomes `active`; otherwise it
 * reverts to `invited` (the invitation is still outstanding). Revoked grants are
 * left untouched.
 */
export async function syncGitHubRepoGrant(
  client: GitHubAccessClient,
  grant: GitHubRepoAccessGrant,
): Promise<GitHubRepoAccessGrant> {
  if (grant.status === "revoked") return grant;
  const permission = await client.getRepoCollaboratorPermission({
    installationId: grant.installationId,
    owner: grant.repoOwner,
    repo: grant.repoName,
    username: grant.githubUsername,
  });
  return { ...grant, status: permission === "none" ? "invited" : "active" };
}

function emptyRun(startedAt: string, finishedAt: string): GitHubAccessSyncRun {
  return {
    startedAt,
    finishedAt,
    total: 0,
    activated: 0,
    reinvited: 0,
    revoked: 0,
    failed: 0,
    outcomes: [],
  };
}

async function reconcileOne(
  client: GitHubAccessClient,
  expected: ExpectedRepoAccess,
  now: Date,
): Promise<GitHubAccessSyncOutcome> {
  const { grant } = expected;
  const meta = {
    grantId: grant.id,
    githubUsername: grant.githubUsername,
    repoOwner: grant.repoOwner,
    repoName: grant.repoName,
  } as const;

  try {
    // Expired entitlements must lose access regardless of current GitHub state.
    if (expected.expired) {
      if (grant.status !== "revoked") {
        await revokeGitHubRepoAccess(client, {
          installationId: grant.installationId,
          repoOwner: grant.repoOwner,
          repoName: grant.repoName,
          githubUsername: grant.githubUsername,
        });
      }
      return { ...meta, action: "revoked", grant: markGitHubGrantRevoked(grant, now) };
    }

    // Already revoked and still expected-revoked: nothing to do.
    if (grant.status === "revoked") {
      return { ...meta, action: "noop", grant };
    }

    const permission = await client.getRepoCollaboratorPermission({
      installationId: grant.installationId,
      owner: grant.repoOwner,
      repo: grant.repoName,
      username: grant.githubUsername,
    });

    if (permission !== "none") {
      // Access is live. Promote invited -> active; otherwise a no-op.
      if (grant.status !== "active") {
        return { ...meta, action: "activated", grant: { ...grant, status: "active" } };
      }
      return { ...meta, action: "noop", grant: { ...grant, status: "active" } };
    }

    // GitHub shows no access. Re-invite so the user can (re)accept.
    const fresh = await grantGitHubRepoAccess(
      client,
      {
        organizationId: grant.organizationId,
        installationId: grant.installationId,
        customerId: grant.customerId,
        entitlementId: grant.entitlementId,
        repoOwner: grant.repoOwner,
        repoName: grant.repoName,
        githubUsername: grant.githubUsername,
      },
      now,
    );
    // Preserve the original grant identity while adopting the new invite state.
    const reinvited: GitHubRepoAccessGrant = {
      ...grant,
      status: fresh.status,
      ...(fresh.invitationId !== undefined ? { invitationId: fresh.invitationId } : {}),
    };
    return { ...meta, action: "reinvited", grant: reinvited };
  } catch (error) {
    const settleError = toGitHubIntegrationError(error, `syncAccess(${meta.repoOwner}/${meta.repoName}:${meta.githubUsername})`);
    return { ...meta, action: "noop", grant: { ...grant, status: "failed" }, error: settleError.message };
  }
}

/**
 * Reconcile a batch of expected grants against GitHub's real collaborator state:
 *  - expired grants are revoked,
 *  - outstanding invitations / dropped access are re-invited,
 *  - confirmed collaborators are activated,
 *  - per-grant failures are captured without aborting the whole run.
 *
 * Returns a {@link GitHubAccessSyncRun} summarising every action taken.
 */
export async function syncAccess(
  client: GitHubAccessClient,
  expected: readonly ExpectedRepoAccess[],
  now = new Date(),
): Promise<GitHubAccessSyncRun> {
  const startedAt = now.toISOString();
  if (expected.length === 0) {
    const finishedAt = new Date().toISOString();
    return emptyRun(startedAt, finishedAt);
  }

  const outcomes: GitHubAccessSyncOutcome[] = [];
  for (const item of expected) {
    outcomes.push(await reconcileOne(client, item, now));
  }

  const run: GitHubAccessSyncRun = {
    startedAt,
    finishedAt: new Date().toISOString(),
    total: outcomes.length,
    activated: outcomes.filter((o) => o.action === "activated").length,
    reinvited: outcomes.filter((o) => o.action === "reinvited").length,
    revoked: outcomes.filter((o) => o.action === "revoked").length,
    failed: outcomes.filter((o) => o.error !== undefined).length,
    outcomes,
  };
  return run;
}
