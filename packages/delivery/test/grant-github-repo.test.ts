import { describe, expect, it } from "vitest";
import { grantGitHubRepo } from "../src/index.js";

describe("grantGitHubRepo", () => {
  it("returns repo delivery output", async () => {
    await expect(
      grantGitHubRepo(
        { type: "github_invite", repoId: "repo_1" },
        { organizationId: "org_1", paymentId: "pay_1", customerId: "cus_1", collectedFields: { githubUsername: "buyer" } },
      ),
    ).resolves.toMatchObject({ repoId: "repo_1", githubUsername: "buyer" });
  });
});
