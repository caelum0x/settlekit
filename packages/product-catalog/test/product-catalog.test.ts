import { describe, expect, it } from "vitest";
import { PRODUCT_TEMPLATES, createProductDraft, publishProduct } from "../src/index.js";

describe("product catalog", () => {
  it("creates and publishes product drafts", () => {
    const product = createProductDraft({
      merchantId: "mch_1",
      organizationId: "org_1",
      name: "Repo Pro",
      description: "Private repo",
      template: PRODUCT_TEMPLATES.githubRepo,
    });
    expect(product.deliveryMode).toBe("github_invite");
    expect(publishProduct(product, [{ id: "price_1", productId: product.id, amount: "25", currency: "USDC", interval: "one_time", usageBased: false, active: true, createdAt: "" }]).status).toBe("active");
  });
});
