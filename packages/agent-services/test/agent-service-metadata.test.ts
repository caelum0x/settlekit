import { describe, expect, it } from "vitest";
import { unwrap } from "@settlekit/common";
import {
  createAgentService,
  generateAgentMetadata,
  toAgentReadableMetadata,
} from "../src/index.js";

const base = {
  organizationId: "org_1",
  merchantId: "mch_1",
  productId: "prod_1",
  name: "Research API",
  description: "Paid research endpoint",
  endpoint: "https://example.com/research",
  price: "0.05",
  network: "arc" as const,
  inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string" } } },
};

describe("agent service metadata", () => {
  it("produces the exact plan §11 machine-readable shape", () => {
    const service = unwrap(createAgentService(base));
    const metadata = generateAgentMetadata(service);

    expect(metadata).toEqual({
      name: "Research API",
      description: "Paid research endpoint",
      price: "0.05",
      currency: "USDC",
      paymentProtocol: "x402",
      network: "arc",
      endpoint: "https://example.com/research",
      inputSchema: base.inputSchema,
    });
    // Keys present and ordered exactly per §11.
    expect(Object.keys(metadata)).toEqual([
      "name",
      "description",
      "price",
      "currency",
      "paymentProtocol",
      "network",
      "endpoint",
      "inputSchema",
    ]);
  });

  it("includes outputSchema only when present", () => {
    const withOutput = unwrap(
      createAgentService({ ...base, outputSchema: { type: "object" } }),
    );
    expect(generateAgentMetadata(withOutput).outputSchema).toEqual({ type: "object" });

    const withoutOutput = unwrap(createAgentService(base));
    expect(toAgentReadableMetadata(withoutOutput)).not.toHaveProperty("outputSchema");
  });

  it("rejects non-https endpoints", () => {
    const result = createAgentService({ ...base, endpoint: "http://insecure.example" });
    expect(result.ok).toBe(false);
  });
});
