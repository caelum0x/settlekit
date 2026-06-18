import { describe, expect, it } from "vitest";
import { fromBaseUnits, toBaseUnits } from "@settlekit/common";
import { HeuristicDecisionEngine } from "@settlekit/agent";
import { runAgentEconomy } from "../src/economy.js";
import { seedLeptonSources } from "../src/seed.js";

describe("agent economy (closed loop)", () => {
  it("runs N agents, settles tolls, and reconciles the books", async () => {
    const report = await runAgentEconomy({
      sources: seedLeptonSources(),
      agentCount: 4,
      perAgentBudgetUsdc: "0.004",
      maxPriceUsdc: "0.001",
      maxPurchasesPerAgent: 3,
      makeEngine: () => new HeuristicDecisionEngine(),
    });

    expect(report.agents).toBe(4);
    expect(report.perAgent).toHaveLength(4);
    expect(report.totalPayments).toBeGreaterThan(0);
    expect(report.authorEarnings.length).toBeGreaterThan(0);

    // Conservation: gross volume == author earnings + platform fees (base units).
    const authorsBase = report.authorEarnings.reduce(
      (sum, e) => sum + toBaseUnits(e.amountUsdc),
      0n,
    );
    const feesBase = toBaseUnits(report.platformFeesUsdc);
    const volumeBase = toBaseUnits(report.totalVolumeUsdc);
    expect(fromBaseUnits(authorsBase + feesBase)).toBe(fromBaseUnits(volumeBase));

    // Royalties reached ancestors, not just the directly-purchased works:
    // the root "Origins" author should earn from downstream citations.
    const origins = report.authorEarnings.find(
      (e) => e.wallet === "0x00000000000000000000000000000000000he510d",
    );
    expect(origins).toBeDefined();
  });

  it("respects per-agent budgets", async () => {
    const report = await runAgentEconomy({
      sources: seedLeptonSources(),
      agentCount: 3,
      perAgentBudgetUsdc: "0.0006",
      maxPriceUsdc: "0.001",
      makeEngine: () => new HeuristicDecisionEngine(),
    });
    for (const a of report.perAgent) {
      expect(toBaseUnits(a.spentUsdc)).toBeLessThanOrEqual(toBaseUnits("0.0006"));
    }
  });
});
