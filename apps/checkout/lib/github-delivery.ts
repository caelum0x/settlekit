/**
 * REAL GitHub access delivery for paid checkouts.
 *
 * Uses the merchant's GitHub App installation (`@settlekit/github`
 * `createGitHubAppClient` -> `OctokitGitHubApi` -> `createGitHubAccessClient`)
 * to invite the buyer as a repository collaborator (`grantGitHubRepoAccess`) or
 * add them to an org team. Configuration is read from the environment:
 *
 *   GITHUB_APP_ID                numeric GitHub App id
 *   GITHUB_APP_PRIVATE_KEY       PEM private key (literal "\n" sequences allowed)
 *   GITHUB_APP_INSTALLATION_ID   installation id on the merchant's account/org
 *
 * When any of these are missing the delivery outcome is `pending_setup` — the
 * buyer is told access is pending, and no invite link is ever fabricated.
 */
import {
  OctokitGitHubApi,
  createGitHubAccessClient,
  createGitHubAppClient,
  grantGitHubRepoAccess,
  type GitHubAccessClient,
} from "@settlekit/github";
import type { DeliveryAction, Payment, Product } from "@settlekit/common";

type Env = Readonly<Record<string, string | undefined>>;

export interface GitHubAppConfig {
  appId: number;
  privateKey: string;
  installationId: number;
}

export type GitHubAppConfigResult = { ok: true; config: GitHubAppConfig } | { ok: false; error: string };

/** A ready GitHub access client, or why delivery is pending setup. */
export type GitHubDelivery =
  | { ok: true; client: GitHubAccessClient; installationId: number }
  | { ok: false; error: string };

export type GitHubAction = Extract<DeliveryAction, { type: "github_invite" | "github_team_add" }>;

export type GitHubDeliveryOutcome =
  | { status: "delivered"; target: string; invitationId?: number }
  | { status: "pending_setup"; reason: string }
  | { status: "failed"; reason: string };

const PENDING_SETUP_REASON =
  "The merchant has not connected a GitHub App yet (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY / GITHUB_APP_INSTALLATION_ID).";

function positiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return undefined;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Read GitHub App credentials from `env`; an error result when incomplete. */
export function loadGitHubAppConfig(env: Env = process.env): GitHubAppConfigResult {
  const appId = positiveInt(env.GITHUB_APP_ID);
  const installationId = positiveInt(env.GITHUB_APP_INSTALLATION_ID);
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (appId === undefined || installationId === undefined || !privateKey) {
    return { ok: false, error: PENDING_SETUP_REASON };
  }
  return { ok: true, config: { appId, privateKey, installationId } };
}

let cached: { key: string; delivery: GitHubDelivery } | undefined;

/** The process-wide GitHub delivery client (rebuilt only when config changes). */
export function getGitHubDelivery(env: Env = process.env): GitHubDelivery {
  const loaded = loadGitHubAppConfig(env);
  if (!loaded.ok) return loaded;
  const key = `${loaded.config.appId}:${loaded.config.installationId}:${loaded.config.privateKey.length}`;
  if (cached?.key !== key) {
    const octokit = createGitHubAppClient(loaded.config);
    const client = createGitHubAccessClient(new OctokitGitHubApi(octokit));
    cached = { key, delivery: { ok: true, client, installationId: loaded.config.installationId } };
  }
  return cached.delivery;
}

/** Whether a delivery action is fulfilled through GitHub. */
export function isGitHubAction(action: DeliveryAction): action is GitHubAction {
  return action.type === "github_invite" || action.type === "github_team_add";
}

/**
 * Resolve `owner/repo` from an action's repoId or the product metadata
 * (`repoOwner` + `repoName`). `undefined` when the product is not fully
 * configured — delivery never guesses a placeholder repository.
 */
export function resolveRepoTarget(repoId: string, product: Product): { owner: string; repo: string } | undefined {
  const [owner, repo, extra] = repoId.split("/");
  if (owner && repo && extra === undefined) return { owner, repo };
  const metaOwner = product.metadata.repoOwner;
  const metaRepo = product.metadata.repoName;
  if (typeof metaOwner === "string" && metaOwner.length > 0) {
    const name = typeof metaRepo === "string" && metaRepo.length > 0 ? metaRepo : repoId;
    if (name.length > 0 && !name.includes("/")) return { owner: metaOwner, repo: name };
  }
  return undefined;
}

export interface DeliverGitHubInput {
  github: GitHubDelivery;
  action: GitHubAction;
  product: Product;
  payment: Payment;
  entitlementId: string;
  githubUsername: string;
  now?: Date;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "GitHub request failed";
}

/** Invite / add the buyer on GitHub. Never throws: failures become outcomes. */
export async function deliverGitHubAccess(input: DeliverGitHubInput): Promise<GitHubDeliveryOutcome> {
  if (!input.github.ok) return { status: "pending_setup", reason: input.github.error };
  const username = input.githubUsername.trim();
  if (username.length === 0) return { status: "failed", reason: "No GitHub username was collected." };
  const { client, installationId } = input.github;

  try {
    if (input.action.type === "github_team_add") {
      const { orgLogin, teamSlug } = input.action;
      if (!orgLogin || !teamSlug) return { status: "failed", reason: "The product has no GitHub team configured." };
      await client.addTeamMembership({ installationId, orgLogin, teamSlug, username });
      return { status: "delivered", target: `${orgLogin}/${teamSlug}` };
    }

    const target = resolveRepoTarget(input.action.repoId, input.product);
    if (!target) return { status: "failed", reason: "The product has no GitHub repository configured." };
    const grant = await grantGitHubRepoAccess(
      client,
      {
        organizationId: input.payment.organizationId,
        installationId,
        customerId: input.payment.customerId,
        entitlementId: input.entitlementId,
        repoOwner: target.owner,
        repoName: target.repo,
        githubUsername: username,
        permission: input.action.permission ?? "pull",
      },
      input.now,
    );
    return {
      status: "delivered",
      target: `${target.owner}/${target.repo}`,
      ...(grant.invitationId !== undefined ? { invitationId: grant.invitationId } : {}),
    };
  } catch (error) {
    return { status: "failed", reason: errorMessage(error) };
  }
}
