import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  createGitHubAccessClient,
  isValidGitHubUsername,
  verifyGithubUsername,
  type GitHubApi,
} from "../src/index.js";

/** Minimal in-memory GitHubApi backed by a fixed set of known users. */
function makeApi(users: Record<string, number>): GitHubApi {
  return {
    async listInstallationRepositories() {
      return [];
    },
    async listOrgTeams() {
      return [];
    },
    async getUser(username) {
      const id = users[username];
      return id === undefined ? undefined : { id, login: username };
    },
    async addRepoCollaborator() {
      return { invitationId: 1 };
    },
    async removeRepoCollaborator() {},
    async getRepoCollaboratorPermission() {
      return "read";
    },
    async listRepoInvitations() {
      return [];
    },
    async cancelRepoInvitation() {},
    async addTeamMembership() {},
    async removeTeamMembership() {},
  };
}

describe("isValidGitHubUsername", () => {
  it("accepts valid logins and rejects malformed ones", () => {
    expect(isValidGitHubUsername("octocat")).toBe(true);
    expect(isValidGitHubUsername("-bad")).toBe(false);
    expect(isValidGitHubUsername("has space")).toBe(false);
  });
});

describe("verifyGithubUsername", () => {
  it("returns exists + user id for a known user", async () => {
    const api = makeApi({ buyer: 42 });
    const result = await verifyGithubUsername(api, "buyer");
    expect(result.exists).toBe(true);
    expect(result.user?.id).toBe(42);
  });

  it("returns exists=false for an unknown user", async () => {
    const api = makeApi({});
    const result = await verifyGithubUsername(api, "ghost");
    expect(result.exists).toBe(false);
  });

  it("throws a validation error for malformed usernames", async () => {
    const api = makeApi({});
    await expect(verifyGithubUsername(api, "-nope")).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("createGitHubAccessClient", () => {
  it("adapts a GitHubApi into the high-level access client surface", async () => {
    const api = makeApi({});
    const client = createGitHubAccessClient(api);
    const invite = await client.inviteRepoCollaborator({
      installationId: 1,
      owner: "seller",
      repo: "repo",
      username: "buyer",
    });
    expect(invite.invitationId).toBe(1);
    expect(
      await client.getRepoCollaboratorPermission({ installationId: 1, owner: "seller", repo: "repo", username: "buyer" }),
    ).toBe("read");
  });
});
