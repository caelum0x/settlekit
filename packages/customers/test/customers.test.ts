import { describe, expect, it } from "vitest";
import {
  customerMatchesSegment,
  mergeCustomerProfiles,
  normalizeCustomerEmail,
  type CustomerProfile,
} from "../src/index.js";

describe("customers", () => {
  const customer: CustomerProfile = {
    id: "cus_1",
    organizationId: "org_1",
    identity: { email: "Buyer@Example.com", walletAddress: "0x123" },
    status: "active",
    tags: ["repo_buyer"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("normalizes emails for identity matching", () => {
    expect(normalizeCustomerEmail(" Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("matches customer segments", () => {
    expect(customerMatchesSegment(customer, { status: "active", tag: "repo_buyer", hasWallet: true })).toBe(
      true,
    );
    expect(customerMatchesSegment(customer, { tag: "trial" })).toBe(false);
  });

  it("merges duplicate profiles without losing tags", () => {
    const merged = mergeCustomerProfiles(customer, {
      ...customer,
      id: "cus_2",
      name: "Buyer",
      identity: { githubUsername: "octobuyer" },
      tags: ["discord_member"],
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(merged.id).toBe("cus_1");
    expect(merged.name).toBe("Buyer");
    expect(merged.identity.walletAddress).toBe("0x123");
    expect(merged.identity.githubUsername).toBe("octobuyer");
    expect(merged.tags).toEqual(["discord_member", "repo_buyer"]);
  });
});
