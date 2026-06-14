import { describe, expect, it } from "vitest";
import { issuePackageAccessToken, revokePackageAccessToken } from "../src/index.js";

describe("package access", () => {
  it("issues revocable package tokens", () => {
    const token = issuePackageAccessToken("@seller/premium-sdk", "cus_1");
    expect(token.token).toMatch(/^sk_pkg_/);
    expect(revokePackageAccessToken(token).status).toBe("revoked");
  });
});
