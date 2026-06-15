/**
 * End-to-end wiring test.
 *
 * Constructs the concrete delivery clients (the real `@settlekit/*` adapters)
 * pointed at in-memory transports + stores, builds a multi-action delivery plan,
 * and runs it through the REAL `DeliveryRunner`. Asserts the run succeeds, every
 * action executed against its real package, and the resulting grants landed in
 * the worker's data layer.
 */

import { describe, it, expect } from "vitest";
import { generateId, toIso, money, type DeliveryPlan } from "@settlekit/common";
import type { DeliveryContext } from "@settlekit/delivery";
import type {
  GitHubApi,
  GitHubRepository,
  GitHubTeam,
  GitHubUser,
  GitHubCollaboratorPermission,
  GitHubRepoInvitation,
} from "@settlekit/github";
import type { DiscordApi, DiscordRoleRef } from "@settlekit/discord";
import type { EmailTransport, EmailPayload, SendResult } from "@settlekit/notifications";
import type { ArcRpc } from "@settlekit/arc";
import type { ArcTransactionReceipt, Hex } from "@settlekit/arc";
import type { HttpSender, WebhookRequest, DeliveryResult } from "@settlekit/webhooks";
import { loadConfig, type WorkerConfig } from "../src/config.js";
import { buildJobContext } from "../src/runtime.js";
import { InMemoryWorkerStore } from "../src/stores.js";

const TEST_ENV: Record<string, string> = {
  ARC_RPC_URL: "http://localhost:8545",
  ARC_USDC_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_CHAIN_ID: "8453",
  ARC_MIN_CONFIRMATIONS: "2",
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "SettleKit <receipts@settlekit.dev>",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
  GITHUB_INSTALLATION_ID: "9999",
  DISCORD_BOT_TOKEN: "bot.token.value",
  FILE_DELIVERY_BASE_URL: "https://dl.settlekit.dev/download",
  FILE_DELIVERY_SECRET: "file-secret-value",
  LICENSE_TOKEN_SECRET: "license-token-secret",
  WEBHOOK_SIGNING_SECRET: "wh-signing-secret",
};

/** In-memory GitHub transport recording collaborator/team mutations. */
function createInMemoryGitHub(): GitHubApi & { invites: GitHubRepoInvitation[]; teamAdds: string[] } {
  const invites: GitHubRepoInvitation[] = [];
  const teamAdds: string[] = [];
  let nextInvitationId = 100;

  const repos: GitHubRepository[] = [
    { owner: "acme", name: "private-repo", private: true } as GitHubRepository,
  ];
  const teams: GitHubTeam[] = [{ slug: "premium", name: "Premium", id: 1 } as GitHubTeam];

  return {
    invites,
    teamAdds,
    async listInstallationRepositories(): Promise<GitHubRepository[]> {
      return repos;
    },
    async listOrgTeams(): Promise<GitHubTeam[]> {
      return teams;
    },
    async getUser(username: string): Promise<GitHubUser | undefined> {
      return { login: username, id: 7 } as GitHubUser;
    },
    async addRepoCollaborator(input): Promise<{ invitationId?: number }> {
      const invitationId = nextInvitationId++;
      invites.push({
        id: invitationId,
        repository: { owner: input.owner, name: input.repo },
        invitee: { login: input.username },
      } as unknown as GitHubRepoInvitation);
      return { invitationId };
    },
    async removeRepoCollaborator(): Promise<void> {
      /* no-op for the in-memory double */
    },
    async getRepoCollaboratorPermission(): Promise<GitHubCollaboratorPermission> {
      return "write";
    },
    async listRepoInvitations(): Promise<GitHubRepoInvitation[]> {
      return invites;
    },
    async cancelRepoInvitation(): Promise<void> {
      /* no-op */
    },
    async addTeamMembership(input): Promise<void> {
      teamAdds.push(`${input.org}/${input.teamSlug}:${input.username}`);
    },
    async removeTeamMembership(): Promise<void> {
      /* no-op */
    },
  };
}

/** In-memory Discord transport recording role mutations. */
function createInMemoryDiscord(): DiscordApi & { added: DiscordRoleRef[]; removed: DiscordRoleRef[] } {
  const added: DiscordRoleRef[] = [];
  const removed: DiscordRoleRef[] = [];
  return {
    added,
    removed,
    async listGuilds() {
      return [];
    },
    async listGuildRoles() {
      return [];
    },
    async addRole(ref: DiscordRoleRef): Promise<void> {
      added.push(ref);
    },
    async removeRole(ref: DiscordRoleRef): Promise<void> {
      removed.push(ref);
    },
  };
}

/** In-memory email transport recording every dispatched message. */
function createInMemoryEmail(): EmailTransport & { sent: Array<{ payload: EmailPayload; from: string }> } {
  const sent: Array<{ payload: EmailPayload; from: string }> = [];
  return {
    sent,
    async send(payload: EmailPayload, from: string): Promise<SendResult> {
      sent.push({ payload, from });
      return { id: generateId("webhookEvent") };
    },
  };
}

/** In-memory webhook HTTP sender recording every signed request and returning 200. */
function createInMemoryWebhookSender(): HttpSender & { requests: WebhookRequest[] } {
  const requests: WebhookRequest[] = [];
  return {
    requests,
    async send(request: WebhookRequest): Promise<DeliveryResult> {
      requests.push(request);
      return { status: 200, ok: true };
    },
  };
}

/** Arc RPC double returning a successful USDC transfer receipt. */
function createArcRpc(config: WorkerConfig, fromAddr: Hex, amountBase: bigint): ArcRpc {
  const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
  const pad = (hex: string): Hex => `0x${hex.replace(/^0x/, "").padStart(64, "0")}` as Hex;
  const receipt: ArcTransactionReceipt = {
    transactionHash: "0xabc" as Hex,
    blockNumber: 100n,
    status: "success",
    from: fromAddr,
    to: config.arc.usdcAddress,
    logs: [
      {
        address: config.arc.usdcAddress,
        topics: [transferTopic, pad(fromAddr), pad(config.arc.usdcAddress)],
        data: pad(amountBase.toString(16)),
        logIndex: 0,
      },
    ],
  };
  return {
    async getTransactionReceipt(): Promise<ArcTransactionReceipt | null> {
      return receipt;
    },
    async getBlockNumber(): Promise<bigint> {
      return 105n;
    },
  };
}

function buildPlan(organizationId: string): DeliveryPlan {
  return {
    id: generateId("deliveryPlan"),
    organizationId,
    productId: "prod_test",
    actions: [
      { type: "github_invite", repoId: "acme/private-repo", permission: "pull" },
      { type: "github_team_add", orgLogin: "acme", teamSlug: "premium" },
      { type: "license_key_create", policyId: "policy_basic" },
      { type: "api_key_create", scopes: ["read", "write"] },
      { type: "file_access_grant", fileId: "file_123" },
      { type: "discord_role_add", guildId: "guild_1", roleId: "role_1" },
      { type: "saas_entitlement_create", features: { seats: 5, sso: true } },
      { type: "webhook_send", url: "https://example.test/hook" },
      { type: "email_send", template: "access_granted" },
    ],
    createdAt: toIso(new Date()),
  };
}

describe("worker delivery-clients wiring", () => {
  function setup() {
    const config = loadConfig(TEST_ENV);
    const githubApi = createInMemoryGitHub();
    const discordApi = createInMemoryDiscord();
    const emailTransport = createInMemoryEmail();
    const webhookSender = createInMemoryWebhookSender();
    const stores = new InMemoryWorkerStore();
    const arcRpc = createArcRpc(config, "0x2222222222222222222222222222222222222222" as Hex, 1_000_000n);

    const { ctx } = buildJobContext({
      config,
      githubApi,
      discordApi,
      emailTransport,
      webhookSender,
      stores,
      arcRpc,
    });
    return { ctx, githubApi, discordApi, emailTransport, webhookSender, stores, config };
  }

  it("runs every delivery action end-to-end through the real runner", async () => {
    const { ctx, githubApi, discordApi, emailTransport, webhookSender, stores } = setup();
    const organizationId = generateId("organization");
    const plan = buildPlan(organizationId);

    const deliveryCtx: DeliveryContext = {
      organizationId,
      customerId: "cus_test",
      productId: "prod_test",
      paymentId: "pay_test",
      entitlementId: "ent_test",
      githubInstallationId: 9999,
      githubUsername: "octobuyer",
      discordUserId: "discord_user_1",
      customerEmail: "buyer@example.test",
      clients: ctx.clients,
    };

    const run = await ctx.runner.run(plan, deliveryCtx, {
      paymentId: "pay_test",
      customerId: "cus_test",
    });

    expect(run.status).toBe("succeeded");
    expect(run.actionRuns).toHaveLength(9);
    for (const actionRun of run.actionRuns) {
      expect(actionRun.status).toBe("succeeded");
    }

    // Real adapters touched their real transports / stores.
    expect(githubApi.invites).toHaveLength(1);
    expect(githubApi.teamAdds).toContain("acme/premium:octobuyer");
    expect(discordApi.added).toHaveLength(1);
    expect(emailTransport.sent).toHaveLength(1);
    expect(emailTransport.sent[0]?.payload.to).toBe("buyer@example.test");
    expect(webhookSender.requests).toHaveLength(1);
    expect(webhookSender.requests[0]?.url).toBe("https://example.test/hook");

    // Grants persisted into the worker's data layer.
    expect((await stores.allGithubGrants()).length).toBeGreaterThanOrEqual(2);
    expect(await stores.allDiscordGrants()).toHaveLength(1);

    // The license action produced a real key id in its output.
    const licenseRun = run.actionRuns.find((a) => a.action.type === "license_key_create");
    expect(licenseRun?.output).toBeDefined();
  });

  it("confirms a payment via the Arc client and enqueues its delivery", async () => {
    const { ctx, stores, config } = setup();
    const now = new Date();

    const payment = await stores.upsertPayment({
      id: "pay_confirm",
      organizationId: generateId("organization"),
      checkoutSessionId: "cs_1",
      customerId: "cus_1",
      amount: money("1.00", "USDC"),
      network: "arc",
      txHash: "0xabc",
      confirmations: 0,
      status: "pending",
      createdAt: toIso(now),
    });

    // Queue a delivery run tied to the payment so confirmation enqueues it.
    const plan = buildPlan(payment.organizationId);
    const initial = ctx.runner.createRun(
      plan,
      {
        organizationId: payment.organizationId,
        customerId: "cus_1",
        productId: "prod_test",
        paymentId: payment.id,
        entitlementId: "ent_1",
        clients: ctx.clients,
      },
      { paymentId: payment.id, customerId: "cus_1" },
    );
    await stores.enqueueDelivery({
      run: { ...initial, status: "pending" },
      plan,
      customerId: "cus_1",
      paymentId: payment.id,
      entitlementId: "ent_1",
      productId: "prod_test",
      organizationId: payment.organizationId,
    });

    const { paymentConfirmJob } = await import("../src/jobs/index.js");
    const result = await paymentConfirmJob.run(ctx);

    expect(result.processed).toBe(1);
    const confirmed = await stores.getPayment("pay_confirm");
    expect(confirmed?.status).toBe("confirmed");
    expect(confirmed?.confirmations).toBeGreaterThanOrEqual(config.arc.minConfirmations);
  });
});
