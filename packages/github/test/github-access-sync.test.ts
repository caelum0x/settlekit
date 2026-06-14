import { describe, expect, it } from "vitest";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { syncGitHubRepoGrant, type GitHubAccessClient } from "../src/index.js";

describe("syncGitHubRepoGrant", () => {
  it("marks grants active when GitHub reports permission", async () => {
    const client: GitHubAccessClient = {
      async inviteRepoCollaborator() { return {}; },
      async removeRepoCollaborator() {},
      async addTeamMembership() {},
      async removeTeamMembership() {},
      async getRepoCollaboratorPermission() { return "read"; },
    };
    const grant = {
      id: "ghra_1",
      organizationId: "org_1",
      installationId: 1,
      customerId: "cus_1",
      entitlementId: "ent_1",
      repoOwner: "seller",
      repoName: "repo",
      githubUsername: "buyer",
      status: "invited",
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies GitHubRepoAccessGrant;
    expect((await syncGitHubRepoGrant(client, grant)).status).toBe("active");
  });
});
