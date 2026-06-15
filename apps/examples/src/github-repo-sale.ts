/**
 * Example: sell access to a private GitHub repository.
 *
 * Exercises @settlekit/delivery for real:
 *   1. Build a DeliveryPlan with a single `github_invite` action.
 *   2. Register the built-in github_invite handler in a HandlerRegistry.
 *   3. Run the plan through a DeliveryRunner with a working in-memory
 *      GitHubAccessClient adapter (the same interface a real GitHub REST
 *      adapter implements) and the rest of the clients stubbed-as-unused.
 *   4. Assert the run succeeded and inspect the issued repo-access grant.
 *
 * This shows the REAL wiring: plan -> registry -> runner -> client adapter.
 */
import {
  DeliveryRunner,
  createRegistry,
  grantGithubRepoHandler,
} from "@settlekit/delivery";
import type {
  DeliveryClients,
  DeliveryContext,
  GithubAccessClient,
} from "@settlekit/delivery";
import { generateId, toIso } from "@settlekit/common";
import type {
  DeliveryPlan,
  GitHubRepoAccessGrant,
} from "@settlekit/common";

export interface GithubRepoSaleResult {
  runStatus: string;
  actionStatus: string;
  invitedUsername: string;
  repo: string;
  invitationId: number | null;
  inviteCalls: number;
}

/**
 * A working in-memory GitHubAccessClient. It records every invite and returns a
 * real GitHubRepoAccessGrant — exactly what a production adapter backed by the
 * GitHub REST API would return, minus the network call.
 */
class InMemoryGitHubAccessClient implements GithubAccessClient {
  readonly grants: GitHubRepoAccessGrant[] = [];
  private nextInvitationId = 9000;

  async inviteCollaborator(input: {
    organizationId: string;
    customerId: string;
    entitlementId: string;
    installationId: number;
    repoOwner: string;
    repoName: string;
    githubUsername: string;
    permission: "pull" | "push" | "maintain";
  }): Promise<GitHubRepoAccessGrant> {
    const grant: GitHubRepoAccessGrant = {
      id: generateId("githubRepoAccess"),
      organizationId: input.organizationId,
      installationId: input.installationId,
      customerId: input.customerId,
      entitlementId: input.entitlementId,
      repoOwner: input.repoOwner,
      repoName: input.repoName,
      githubUsername: input.githubUsername,
      invitationId: this.nextInvitationId++,
      status: "invited",
      createdAt: toIso(new Date()),
    };
    this.grants.push(grant);
    return grant;
  }

  async removeCollaborator(): Promise<void> {
    // Rollback path; unused in the happy-path example.
  }

  async addTeamMembership(): Promise<GitHubRepoAccessGrant> {
    throw new Error("not used in this example");
  }

  async removeTeamMembership(): Promise<void> {
    // unused
  }
}

/**
 * Build the DeliveryClients bag. Only `github` is wired with a working adapter;
 * the other clients throw if invoked because this plan never uses them.
 */
function buildClients(github: GithubAccessClient): DeliveryClients {
  const unused = (name: string) =>
    new Proxy(
      {},
      {
        get() {
          return () => {
            throw new Error(`${name} client should not be called by this plan`);
          };
        },
      },
    );
  return {
    github,
    discord: unused("discord") as DeliveryClients["discord"],
    license: unused("license") as DeliveryClients["license"],
    apiKey: unused("apiKey") as DeliveryClients["apiKey"],
    file: unused("file") as DeliveryClients["file"],
    saas: unused("saas") as DeliveryClients["saas"],
    webhook: unused("webhook") as DeliveryClients["webhook"],
    email: unused("email") as DeliveryClients["email"],
  };
}

export async function main(): Promise<GithubRepoSaleResult> {
  const organizationId = "org_ghsale_example";
  const customerId = "cust_ghsale_example";
  const productId = "prod_ghsale_example";

  // 1. Build a delivery plan with a single github_invite action.
  const plan: DeliveryPlan = {
    id: generateId("deliveryPlan"),
    organizationId,
    productId,
    actions: [
      { type: "github_invite", repoId: "acme/private-toolkit", permission: "pull" },
    ],
    createdAt: toIso(new Date()),
  };

  // 2. Register the real github_invite handler.
  const registry = createRegistry([grantGithubRepoHandler()]);

  // 3. Wire the in-memory GitHub adapter and run the plan.
  const github = new InMemoryGitHubAccessClient();
  const runner = new DeliveryRunner(registry, {
    // No backoff sleeps needed in the happy path; keep tests instant anyway.
    sleep: async () => undefined,
  });

  const ctx: DeliveryContext = {
    organizationId,
    customerId,
    productId,
    paymentId: generateId("payment"),
    entitlementId: generateId("entitlement"),
    githubInstallationId: 4242,
    githubUsername: "octo-buyer",
    clients: buildClients(github),
  };

  const run = await runner.run(plan, ctx, {
    paymentId: ctx.paymentId,
    customerId,
  });

  // 4. Assert success and surface the grant details.
  const actionRun = run.actionRuns[0];
  if (!actionRun) throw new Error("no action run produced");
  if (run.status !== "succeeded" || actionRun.status !== "succeeded") {
    throw new Error(
      `expected succeeded run, got ${run.status}/${actionRun.status}: ${actionRun.lastError ?? ""}`,
    );
  }
  if (github.grants.length !== 1) {
    throw new Error(`expected exactly 1 invite, got ${github.grants.length}`);
  }

  const output = actionRun.output ?? {};
  return {
    runStatus: run.status,
    actionStatus: actionRun.status,
    invitedUsername: String(output.githubUsername),
    repo: `${String(output.repoOwner)}/${String(output.repoName)}`,
    invitationId: typeof output.invitationId === "number" ? output.invitationId : null,
    inviteCalls: github.grants.length,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((result) => {
      console.log("[github-repo-sale]", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("[github-repo-sale] failed", err);
      process.exitCode = 1;
    });
}
