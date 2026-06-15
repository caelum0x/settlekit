import { describe, expect, it } from "vitest";
import { isErr, isOk, unwrap } from "@settlekit/common";
import {
  AgentServiceService,
  InMemoryAgentServiceStore,
  InMemoryAgentUsageStore,
  InMemoryAgentReputationStore,
} from "../src/index.js";

function buildService(): AgentServiceService {
  return new AgentServiceService({
    services: new InMemoryAgentServiceStore(),
    usage: new InMemoryAgentUsageStore(),
    reputation: new InMemoryAgentReputationStore(),
    now: () => new Date("2026-06-15T00:00:00.000Z"),
  });
}

const input = {
  organizationId: "org_1",
  merchantId: "mch_1",
  productId: "prod_1",
  name: "Research API",
  description: "Paid research endpoint",
  endpoint: "https://example.com/research",
  price: "0.05",
  network: "arc" as const,
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: { query: { type: "string" } },
  },
};

describe("AgentServiceService", () => {
  it("creates, persists and retrieves a listing", async () => {
    const svc = buildService();
    const created = unwrap(await svc.create(input));
    expect(created.published).toBe(false);
    const fetched = unwrap(await svc.get(created.id));
    expect(fetched.name).toBe("Research API");
  });

  it("publishes and surfaces listings via discovery", async () => {
    const svc = buildService();
    const created = unwrap(await svc.create(input));
    expect(await svc.discover()).toHaveLength(0); // unpublished hidden by default
    await svc.publish(created.id);
    const published = await svc.discover({ network: "arc", text: "research" });
    expect(published).toHaveLength(1);
  });

  it("validates input on invoke and records usage", async () => {
    const svc = buildService();
    const created = unwrap(await svc.create(input));

    const bad = await svc.invoke(created.id, { query: 123 }, "cus_1");
    expect(isErr(bad)).toBe(true);

    const good = await svc.invoke(created.id, { query: "hello" }, "cus_1", 2);
    expect(isOk(good)).toBe(true);
    if (isOk(good)) {
      expect(good.value.units).toBe(2);
      expect(good.value.amount).toEqual({ amount: "0.1", currency: "USDC" });
    }
  });

  it("aggregates reputation across ratings", async () => {
    const svc = buildService();
    const created = unwrap(await svc.create(input));
    await svc.rate(created.id, 5);
    await svc.rate(created.id, 3);
    const rep = await svc.getReputation(created.id);
    expect(rep.ratingCount).toBe(2);
    expect(rep.ratingAverage).toBe(4);
  });

  it("returns not_found for unknown ids", async () => {
    const svc = buildService();
    const result = await svc.get("ags_missing");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("not_found");
  });
});
