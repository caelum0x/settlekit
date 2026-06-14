import { describe, expect, it } from "vitest";
import { createAgentService, toAgentReadableMetadata } from "../src/index.js";

describe("agent service metadata", () => {
  it("creates machine-readable metadata", () => {
    const service = createAgentService({
      organizationId: "org_1",
      merchantId: "mch_1",
      productId: "prod_1",
      name: "Research API",
      description: "Paid research endpoint",
      endpoint: "https://example.com/research",
      price: "0.05",
      currency: "USDC",
      paymentProtocol: "x402",
      network: "arc",
      inputSchema: { type: "object" },
    });
    expect(toAgentReadableMetadata(service).paymentProtocol).toBe("x402");
  });
});
