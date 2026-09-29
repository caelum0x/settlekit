/**
 * github-delivery-retry job: pending GitHub entitlements from checkout are
 * re-delivered through the real GitHub App access client once an
 * installation is configured, then flipped to active; failures back off.
 */
import { describe, expect, it } from "vitest";
import { money, toIso, type Entitlement, type Payment, type Product } from "@settlekit/common";
import type { GitHubApi } from "@settlekit/github";
import type { DiscordApi } from "@settlekit/discord";
import { loadConfig } from "../src/config.js";
import { buildJobContext } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";
import { allJobs, workerJobs } from "../src/jobs/index.js";
import {
  RETRY_BASE_MS,
  createGithubDeliveryRetryJob,
  resolveGitHubTarget,
} from "../src/jobs/github-delivery-retry-job.js";

const ENV: Record<string, string> = {
  ARC_RPC_URL: "http://localhost:8545",
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  RESEND_API_KEY: "re_test_key",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  DISCORD_BOT_TOKEN: "bot.token.value",
  FILE_DELIVERY_BASE_URL: "https://dl.settlekit.dev/download",
  FILE_DELIVERY_SECRET: "file-secret-value",
  LICENSE_TOKEN_SECRET: "license-token-secret",
  WEBHOOK_SIGNING_SECRET: "wh-signing-secret",
};
const NOW = new Date("2026-09-29T12:00:00.000Z");

interface GitHubCalls {
  collaborators: Array<{ owner: string; repo: string; username: string; permission: string }>;
  teams: Array<{ org: string; teamSlug: string; username: string }>;
}

function fakeGitHub(calls: GitHubCalls, options: { failCollaborator?: boolean } = {}): GitHubApi {
  const unused = async () => {
    throw new Error("not used");
  };
  return {
    listInstallationRepositories: unused,
    listOrgTeams: unused,
    getUser: async () => undefined,
    async addRepoCollaborator(input) {
      if (options.failCollaborator) throw Object.assign(new Error("Not Found"), { status: 404 });
      calls.collaborators.push(input);
      return { invitationId: 77 };
    },
    removeRepoCollaborator: unused,
    getRepoCollaboratorPermission: unused,
    listRepoInvitations: async () => [],
    cancelRepoInvitation: unused,
    async addTeamMembership(input) {
      calls.teams.push({ org: input.org, teamSlug: input.teamSlug, username: input.username });
    },
    removeTeamMembership: unused,
  };
}

function setup(env: Record<string, string>, options: { failCollaborator?: boolean } = {}) {
  const stores = new InMemoryWorkerStore();
  const calls: GitHubCalls = { collaborators: [], teams: [] };
  let clock = NOW;
  const { ctx } = buildJobContext({
    config: loadConfig({ ...ENV, ...env }),
    githubApi: fakeGitHub(calls, options),
    discordApi: {} as DiscordApi,
    emailTransport: { send: async () => ({ id: "email_1" }) },
    stores,
    now: () => clock,
  });
  return {
    ctx,
    stores,
    calls,
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const product: Product = {
  id: "prod_repo",
  merchantId: "mch_1",
  organizationId: "org_1",
  name: "Atlas Starter",
  description: "",
  type: "github_repo_access",
  status: "active",
  deliveryMode: "github_invite",
  metadata: { repoOwner: "acme-dev", repoName: "atlas-starter", permission: "push" },
  createdAt: toIso(NOW),
  updatedAt: toIso(NOW),
};

async function seed(
  stores: InMemoryWorkerStore,
  options: {
    id?: string;
    paymentStatus?: Payment["status"];
    username?: string | null;
    entitlement?: Partial<Entitlement>;
  } = {},
): Promise<Entitlement> {
  const id = options.id ?? "1";
  await stores.upsertProduct(product);
  await stores.upsertCheckoutSession({
    id: `cs_${id}`,
    organizationId: "org_1",
    merchantId: "mch_1",
    customerId: "cus_1",
    lineItems: [{ productId: product.id, priceId: "price_1", quantity: 1 }],
    amount: money("49", "USDC"),
    status: "completed",
    payToAddress: "0x3333333333333333333333333333333333333333",
    network: "base",
    expiresAt: toIso(new Date(NOW.getTime() + 86_400_000)),
    collectedFields: options.username === null ? {} : { githubUsername: options.username ?? "octocat" },
    createdAt: toIso(NOW),
  });
  await stores.upsertPayment({
    id: `pay_${id}`,
    organizationId: "org_1",
    checkoutSessionId: `cs_${id}`,
    customerId: "cus_1",
    amount: money("49", "USDC"),
    network: "base",
    txHash: `0x${id.padStart(64, "0")}`,
    confirmations: 3,
    status: options.paymentStatus ?? "confirmed",
    createdAt: toIso(NOW),
  });
  return stores.upsertEntitlement({
    id: `ent_${id}`,
    organizationId: "org_1",
    customerId: "cus_1",
    productId: product.id,
    grantedBy: { type: "payment", id: `pay_${id}` },
    entitlementType: "github_repo_access",
    resourceId: "prod_repo",
    status: "pending",
    createdAt: toIso(NOW),
    updatedAt: toIso(NOW),
    ...options.entitlement,
  });
}

describe("github-delivery-retry job", () => {
  it("is scheduled with the other worker jobs", () => {
    expect(workerJobs).toContain("github-delivery-retry");
    expect(allJobs().map((job) => job.name)).toContain("github-delivery-retry");
  });

  it("does nothing until a GitHub App installation is configured", async () => {
    const { ctx, stores, calls } = setup({});
    await seed(stores);
    expect(await createGithubDeliveryRetryJob().run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(calls.collaborators).toHaveLength(0);
  });

  it("invites the buyer to the product repo and activates the entitlement", async () => {
    // The checkout's variable name is accepted as well.
    const { ctx, stores, calls } = setup({ GITHUB_APP_INSTALLATION_ID: "4242" });
    await seed(stores);

    const job = createGithubDeliveryRetryJob();
    expect(await job.run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(calls.collaborators).toEqual([
      { owner: "acme-dev", repo: "atlas-starter", username: "octocat", permission: "push" },
    ]);
    const entitlement = (await stores.allEntitlements())[0];
    expect(entitlement).toMatchObject({ status: "active", resourceId: "acme-dev/atlas-starter", updatedAt: toIso(NOW) });
    expect((await stores.allGithubGrants())[0]).toMatchObject({ installationId: 4242, githubUsername: "octocat" });

    // Delivered once: the next tick has nothing to do.
    expect(await job.run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(calls.collaborators).toHaveLength(1);
  });

  it("adds the buyer to an org team for team entitlements", async () => {
    const { ctx, stores, calls } = setup({ GITHUB_INSTALLATION_ID: "9999" });
    await seed(stores, { entitlement: { entitlementType: "github_team_access", resourceId: "acme-dev/founders" } });
    expect(await createGithubDeliveryRetryJob().run(ctx)).toEqual({ processed: 1, failed: 0 });
    expect(calls.teams).toEqual([{ org: "acme-dev", teamSlug: "founders", username: "octocat" }]);
  });

  it("skips unconfirmed payments, active entitlements and runs owned by the delivery runner", async () => {
    const { ctx, stores, calls } = setup({ GITHUB_INSTALLATION_ID: "9999" });
    await seed(stores, { id: "1", paymentStatus: "pending" });
    await seed(stores, { id: "2", entitlement: { status: "active" } });
    await seed(stores, { id: "3", entitlement: { entitlementType: "license_key" } });
    await seed(stores, { id: "4" });
    await stores.enqueueDelivery({
      run: { id: "run_4", status: "pending" } as never,
      plan: {} as never,
      customerId: "cus_1",
      paymentId: "pay_4",
      entitlementId: "ent_4",
      productId: product.id,
      organizationId: "org_1",
    });
    expect(await createGithubDeliveryRetryJob().run(ctx)).toEqual({ processed: 0, failed: 0 });
    expect(calls.collaborators).toHaveLength(0);
  });

  it("backs off after a failure and succeeds once GitHub accepts", async () => {
    const failing = setup({ GITHUB_INSTALLATION_ID: "9999" }, { failCollaborator: true });
    await seed(failing.stores);
    const job = createGithubDeliveryRetryJob();
    expect(await job.run(failing.ctx)).toEqual({ processed: 0, failed: 1 });
    // Inside the backoff window nothing is retried.
    failing.advance(RETRY_BASE_MS - 1);
    expect(await job.run(failing.ctx)).toEqual({ processed: 0, failed: 0 });
    failing.advance(1);
    expect(await job.run(failing.ctx)).toEqual({ processed: 0, failed: 1 });
    // Second failure doubles the wait.
    failing.advance(RETRY_BASE_MS);
    expect(await job.run(failing.ctx)).toEqual({ processed: 0, failed: 0 });
    expect((await failing.stores.allEntitlements())[0]?.status).toBe("pending");
  });

  it("fails (never guesses) without a username or a configured repository", async () => {
    const { ctx, stores } = setup({ GITHUB_INSTALLATION_ID: "9999" });
    await seed(stores, { id: "1", username: null });
    expect(await createGithubDeliveryRetryJob().run(ctx)).toEqual({ processed: 0, failed: 1 });
    expect(resolveGitHubTarget({ entitlementType: "github_repo_access", resourceId: "bare" } as Entitlement, undefined)).toBeUndefined();
    expect(
      resolveGitHubTarget({ entitlementType: "github_repo_access", resourceId: "owner/repo" } as Entitlement, undefined),
    ).toEqual({ kind: "repo", owner: "owner", repo: "repo", permission: "pull" });
  });
});
