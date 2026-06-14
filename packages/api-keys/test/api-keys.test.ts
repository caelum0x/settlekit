import { describe, expect, it } from "vitest";
import { apiKeyHasScope, issueApiKey } from "../src/index.js";

describe("api keys", () => {
  it("issues hashed API keys with scopes", () => {
    const issued = issueApiKey({
      organizationId: "org_1",
      customerId: "cus_1",
      productId: "prod_1",
      entitlementId: "ent_1",
      scopes: ["api:read"],
    });
    expect(issued.secret).toMatch(/^sk_live_/);
    expect(issued.apiKey.keyHash).not.toBe(issued.secret);
    expect(apiKeyHasScope(issued.apiKey, "api:read")).toBe(true);
  });
});
