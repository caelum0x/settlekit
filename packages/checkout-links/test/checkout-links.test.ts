import { describe, expect, it } from "vitest";
import { createCheckoutLink, deactivateCheckoutLink } from "../src/index.js";

describe("checkout links", () => {
  it("creates hosted checkout URLs", () => {
    const link = createCheckoutLink({ merchantId: "mch_1", baseUrl: "https://pay.settlekit.dev", slug: "repo-pro", productId: "prod_1" });
    expect(link.url).toBe("https://pay.settlekit.dev/checkout/repo-pro");
    expect(deactivateCheckoutLink(link).active).toBe(false);
  });
});
