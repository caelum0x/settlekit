import { describe, expect, it } from "vitest";
import { compareMoney, isOk, money } from "@settlekit/common";
import { InMemoryAgentReputationStore } from "@settlekit/agent-services";
import { createLocalSettlement } from "@settlekit/x402-client";
import {
  InMemorySourceRegistry,
  createCitationTollRouter,
  createSource,
  toAgentServiceListing,
} from "@settlekit/citation-toll";
import { PayingAgent } from "../src/agent.js";
import { HeuristicDecisionEngine } from "../src/heuristic-engine.js";

const BASE = "https://toll.test";

function buildMarket() {
  const registry = new InMemorySourceRegistry();
  const specs = [
    { title: "Cheap byte", wallet: "0xauthor1", price: "0.001" },
    { title: "Mid byte", wallet: "0xauthor2", price: "0.003" },
    { title: "Pricey byte", wallet: "0xauthor3", price: "0.02" }, // above per-call cap
  ];
  for (const s of specs) {
    const created = createSource({
      organizationId: "org_lepton",
      title: s.title,
      authorWallet: s.wallet,
      priceUsdc: s.price,
      body: `content of ${s.title}`,
    });
    if (!isOk(created)) throw new Error("createSource failed");
    registry.add(created.value);
  }

  const listings = registry.all().map((src) => toAgentServiceListing(src, { baseUrl: BASE }));
  const settlement = createLocalSettlement();
  const router = createCitationTollRouter(registry, {
    verify: settlement.verify,
    distributor: () => {},
  });

  return { registry, listings, settlement, router };
}

describe("PayingAgent (heuristic engine, closed loop)", () => {
  it("autonomously discovers and pays for services within budget", async () => {
    const { listings, settlement, router } = buildMarket();
    const reputation = new InMemoryAgentReputationStore();

    const agent = new PayingAgent({
      services: listings,
      reputation,
      fetcher: router,
      settler: settlement.settler,
      from: "0xagent",
      policy: {
        totalBudgetUsdc: "0.01",
        maxPriceUsdc: "0.005",
        maxPurchases: 5,
      },
    });

    const result = await agent.run(
      { objective: "Gather as much cited content as the budget allows." },
      new HeuristicDecisionEngine(),
    );

    expect(result.engine).toBe("heuristic");
    expect(result.purchases.length).toBeGreaterThanOrEqual(1);

    // Never exceeds the total budget.
    expect(compareMoney(result.totalSpent, money("0.01"))).toBeLessThanOrEqual(0);

    // Every purchase respects the per-call cap (the 0.02 source is never bought).
    for (const p of result.purchases) {
      expect(compareMoney(p.amount, money("0.005"))).toBeLessThanOrEqual(0);
    }
    const boughtPrices = result.purchases.map((p) => p.amount.amount);
    expect(boughtPrices).not.toContain("0.02");

    // Real settlement volume matches what the agent spent.
    expect(compareMoney(settlement.ledger.totalVolume(), result.totalSpent)).toBe(0);

    // It rated what it used.
    for (const p of result.purchases) {
      const rep = await reputation.get(p.serviceId);
      expect(rep.ratingCount).toBeGreaterThanOrEqual(1);
    }
  });

  it("stops when the budget is exhausted", async () => {
    const { listings, settlement, router } = buildMarket();
    const reputation = new InMemoryAgentReputationStore();

    const agent = new PayingAgent({
      services: listings,
      reputation,
      fetcher: router,
      settler: settlement.settler,
      from: "0xagent",
      // Only enough for the single cheapest call (0.001).
      policy: { totalBudgetUsdc: "0.001", maxPriceUsdc: "0.005" },
    });

    const result = await agent.run(
      { objective: "Spend carefully." },
      new HeuristicDecisionEngine(),
    );

    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]?.amount.amount).toBe("0.001");
    expect(compareMoney(result.remaining, money("0"))).toBeGreaterThanOrEqual(0);
  });
});
