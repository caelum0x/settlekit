import { describe, expect, it } from "vitest";
import type { GitHubRepoAccessGrant } from "@settlekit/common";
import { markGitHubGrantRevoked } from "../src/index.js";

describe("markGitHubGrantRevoked", () => {
  it("records revocation state", () => {
    const grant = {
      id: "ghra_1",
      organizationId: "org_1",
      installationId: 1,
      customerId: "cus_1",
      entitlementId: "ent_1",
      repoOwner: "seller",
      repoName: "repo",
      githubUsername: "buyer",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies GitHubRepoAccessGrant;
    expect(markGitHubGrantRevoked(grant).status).toBe("revoked");
  });
});
