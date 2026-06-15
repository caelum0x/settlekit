import { describe, expect, it } from "vitest";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { syncAccess, type ExpectedRepoAccess, type GitHubAccessClient } from "../src/index.js";

function grant(overrides: Partial<GitHubRepoAccessGrant> = {}): GitHubRepoAccessGrant {
  return {
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
    ...overrides,
  };
}

/** In-memory GitHubAccessClient driven by a permission map keyed by username. */
function makeClient(perms: Record<string, "none" | "read" | "write" | "admin">): {
  client: GitHubAccessClient;
  removed: string[];
  invited: string[];
} {
  const removed: string[] = [];
  const invited: string[] = [];
  const client: GitHubAccessClient = {
    async inviteRepoCollaborator({ username }) {
      invited.push(username);
      return { invitationId: 999 };
    },
    async removeRepoCollaborator({ username }) {
      removed.push(username);
    },
    async addTeamMembership() {},
    async removeTeamMembership() {},
    async getRepoCollaboratorPermission({ username }) {
      return perms[username] ?? "none";
    },
  };
  return { client, removed, invited };
}

describe("syncAccess", () => {
  it("returns an empty run for no expected grants", async () => {
    const { client } = makeClient({});
    const run = await syncAccess(client, []);
    expect(run.total).toBe(0);
    expect(run.outcomes).toEqual([]);
  });

  it("activates grants GitHub reports as accessible", async () => {
    const { client } = makeClient({ buyer: "read" });
    const run = await syncAccess(client, [{ grant: grant({ status: "invited" }) }]);
    expect(run.activated).toBe(1);
    expect(run.outcomes[0]?.grant.status).toBe("active");
  });

  it("re-invites grants that lost access", async () => {
    const { client, invited } = makeClient({ buyer: "none" });
    const run = await syncAccess(client, [{ grant: grant({ status: "active" }) }]);
    expect(run.reinvited).toBe(1);
    expect(invited).toContain("buyer");
    expect(run.outcomes[0]?.grant.invitationId).toBe(999);
  });

  it("revokes expired grants and records revocation", async () => {
    const { client, removed } = makeClient({ buyer: "write" });
    const expected: ExpectedRepoAccess = { grant: grant({ status: "active" }), expired: true };
    const run = await syncAccess(client, [expected]);
    expect(run.revoked).toBe(1);
    expect(removed).toContain("buyer");
    expect(run.outcomes[0]?.grant.status).toBe("revoked");
    expect(run.outcomes[0]?.grant.revokedAt).toBeDefined();
  });

  it("captures per-grant failures without aborting the run", async () => {
    const failing: GitHubAccessClient = {
      async inviteRepoCollaborator() {
        return {};
      },
      async removeRepoCollaborator() {},
      async addTeamMembership() {},
      async removeTeamMembership() {},
      async getRepoCollaboratorPermission() {
        const err = Object.assign(new Error("boom"), { status: 500 });
        throw err;
      },
    };
    const run = await syncAccess(failing, [{ grant: grant({ status: "invited" }) }, { grant: grant({ id: "ghra_2" }) }]);
    expect(run.failed).toBe(2);
    expect(run.outcomes[0]?.error).toContain("boom");
    expect(run.outcomes[0]?.grant.status).toBe("failed");
  });
});
