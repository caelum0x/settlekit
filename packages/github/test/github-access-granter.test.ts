import { describe, expect, it } from "vitest";
import { grantGitHubRepoAccess, type GitHubAccessClient } from "../src/index.js";

const client: GitHubAccessClient = {
  async inviteRepoCollaborator() {
    return { invitationId: 123 };
  },
  async removeRepoCollaborator() {},
  async addTeamMembership() {},
  async removeTeamMembership() {},
  async getRepoCollaboratorPermission() {
    return "read";
  },
};

describe("grantGitHubRepoAccess", () => {
  it("creates an invited access grant", async () => {
    const grant = await grantGitHubRepoAccess(client, {
      organizationId: "org_1",
      installationId: 1,
      customerId: "cus_1",
      entitlementId: "ent_1",
      repoOwner: "seller",
      repoName: "private-template",
      githubUsername: "buyer",
    });
    expect(grant.status).toBe("invited");
    expect(grant.invitationId).toBe(123);
  });
});
