import { describe, it, expect } from "vitest";
import { money } from "@settlekit/common";
import {
  RuleEngine,
  computeScore,
  defaultRules,
  decide,
  clampScore,
  DEFAULT_THRESHOLDS,
  type RiskContext,
  type Rule,
} from "../src/index.js";

const NOW = Date.UTC(2026, 5, 14, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function baseContext(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    organizationId: "org_test",
    customerId: "cus_test",
    now: NOW,
    amount: money("10"),
    ...overrides,
  };
}

function eventsAt(count: number, spacingMs: number): { at: number }[] {
  const events: { at: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    events.push({ at: NOW - i * spacingMs });
  }
  return events;
}

describe("clampScore", () => {
  it("clamps below zero to 0", () => {
    expect(clampScore(-50)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(clampScore(250)).toBe(100);
  });

  it("rounds to nearest integer in range", () => {
    expect(clampScore(42.6)).toBe(43);
  });

  it("treats NaN as 0", () => {
    expect(clampScore(Number.NaN)).toBe(0);
  });
});

describe("decide", () => {
  it("allows low scores", () => {
    expect(decide(0)).toBe("allow");
    expect(decide(39)).toBe("allow");
  });

  it("reviews mid scores", () => {
    expect(decide(40)).toBe("review");
    expect(decide(69)).toBe("review");
  });

  it("blocks high scores", () => {
    expect(decide(70)).toBe("block");
    expect(decide(100)).toBe("block");
  });

  it("respects exact threshold boundaries", () => {
    expect(decide(DEFAULT_THRESHOLDS.review)).toBe("review");
    expect(decide(DEFAULT_THRESHOLDS.block)).toBe("block");
    expect(decide(DEFAULT_THRESHOLDS.review - 1)).toBe("allow");
    expect(decide(DEFAULT_THRESHOLDS.block - 1)).toBe("review");
  });

  it("supports custom thresholds", () => {
    expect(decide(20, { review: 10, block: 50 })).toBe("review");
    expect(decide(60, { review: 10, block: 50 })).toBe("block");
  });
});

describe("RuleEngine.scoreTransaction", () => {
  it("scores a clean context low and allows it", () => {
    const engine = new RuleEngine();
    const ctx = baseContext({
      accountCreatedAt: NOW - 400 * DAY,
      recentCheckouts: eventsAt(1, HOUR),
      recentPayments: eventsAt(1, HOUR),
      recentRefunds: [],
      chargebackCount: 0,
      billingCountry: "US",
      ipCountry: "US",
      walletDistinctCustomerCount: 1,
    });

    const profile = engine.scoreTransaction(ctx);

    expect(profile.score).toBe(0);
    expect(profile.flags).toEqual([]);
    expect(profile.organizationId).toBe("org_test");
    expect(engine.decide(profile.score)).toBe("allow");
  });

  it("raises score and collects flags when multiple rules hit", () => {
    const engine = new RuleEngine();
    const ctx = baseContext({
      amount: money("1000"),
      accountCreatedAt: NOW - 2 * HOUR, // new account
      recentCheckouts: eventsAt(10, 60 * 1000), // velocity
      recentPayments: eventsAt(8, 60 * 1000),
      recentRefunds: eventsAt(5, DAY), // refund abuse
      chargebackCount: 2, // chargeback history
      billingCountry: "US",
      ipCountry: "NG", // geo mismatch
      walletDistinctCustomerCount: 5, // wallet reuse
    });

    const profile = engine.scoreTransaction(ctx);

    // high_velocity 25 + new_account 30 + refund 20 + geo/wallet 15 + chargeback 35 = 125 -> clamped 100
    expect(profile.score).toBe(100);
    expect(profile.flags.length).toBe(5);
    expect(engine.decide(profile.score)).toBe("block");
  });

  it("clamps the weighted sum at 100", () => {
    const heavy: Rule[] = [
      { id: "a", weight: 80, evaluate: () => ({ hit: true, reason: "a" }) },
      { id: "b", weight: 80, evaluate: () => ({ hit: true, reason: "b" }) },
    ];
    const engine = new RuleEngine({ rules: heavy });
    const profile = engine.scoreTransaction(baseContext());
    expect(profile.score).toBe(100);
    expect(profile.flags).toEqual(["a", "b"]);
  });

  it("derives updatedAt deterministically from ctx.now", () => {
    const engine = new RuleEngine();
    const profile = engine.scoreTransaction(baseContext());
    expect(profile.updatedAt).toBe(new Date(NOW).toISOString());
  });
});

describe("individual built-in rules", () => {
  const rules = defaultRules();

  it("high_velocity hits only above the limit", () => {
    const underLimit = computeScore(
      baseContext({ recentCheckouts: eventsAt(5, 60 * 1000) }),
      rules,
    );
    expect(underLimit.hitRuleIds).not.toContain("high_velocity");

    const overLimit = computeScore(
      baseContext({ recentCheckouts: eventsAt(6, 60 * 1000) }),
      rules,
    );
    expect(overLimit.hitRuleIds).toContain("high_velocity");
  });

  it("velocity ignores events outside the window", () => {
    const stale = computeScore(
      baseContext({ recentCheckouts: eventsAt(20, 2 * HOUR) }),
      rules,
    );
    expect(stale.hitRuleIds).not.toContain("high_velocity");
  });

  it("new_account_large_amount needs both new account and large amount", () => {
    const newSmall = computeScore(
      baseContext({ accountCreatedAt: NOW - HOUR, amount: money("10") }),
      rules,
    );
    expect(newSmall.hitRuleIds).not.toContain("new_account_large_amount");

    const oldLarge = computeScore(
      baseContext({ accountCreatedAt: NOW - 100 * DAY, amount: money("5000") }),
      rules,
    );
    expect(oldLarge.hitRuleIds).not.toContain("new_account_large_amount");

    const newLarge = computeScore(
      baseContext({ accountCreatedAt: NOW - HOUR, amount: money("600") }),
      rules,
    );
    expect(newLarge.hitRuleIds).toContain("new_account_large_amount");
  });

  it("refund_abuse hits above the refund limit", () => {
    const ok = computeScore(baseContext({ recentRefunds: eventsAt(3, DAY) }), rules);
    expect(ok.hitRuleIds).not.toContain("refund_abuse");

    const abusive = computeScore(baseContext({ recentRefunds: eventsAt(4, DAY) }), rules);
    expect(abusive.hitRuleIds).toContain("refund_abuse");
  });

  it("mismatched_geo_wallet_reuse hits on geo mismatch alone", () => {
    const result = computeScore(
      baseContext({ billingCountry: "DE", ipCountry: "BR" }),
      rules,
    );
    expect(result.hitRuleIds).toContain("mismatched_geo_wallet_reuse");
  });

  it("mismatched_geo_wallet_reuse hits on wallet reuse alone", () => {
    const result = computeScore(
      baseContext({ walletDistinctCustomerCount: 4 }),
      rules,
    );
    expect(result.hitRuleIds).toContain("mismatched_geo_wallet_reuse");
  });

  it("mismatched_geo_wallet_reuse ignores matching geo and unique wallet", () => {
    const result = computeScore(
      baseContext({ billingCountry: "us", ipCountry: "US", walletDistinctCustomerCount: 1 }),
      rules,
    );
    expect(result.hitRuleIds).not.toContain("mismatched_geo_wallet_reuse");
  });

  it("chargeback_history hits when prior chargebacks exist", () => {
    expect(computeScore(baseContext({ chargebackCount: 0 }), rules).hitRuleIds).not.toContain(
      "chargeback_history",
    );
    expect(computeScore(baseContext({ chargebackCount: 1 }), rules).hitRuleIds).toContain(
      "chargeback_history",
    );
  });
});

describe("RuleEngine.assess", () => {
  it("returns profile, decision and hit rule ids together", () => {
    const engine = new RuleEngine();
    const assessment = engine.assess(
      baseContext({ chargebackCount: 1, billingCountry: "US", ipCountry: "FR" }),
    );
    // chargeback 35 + geo 15 = 50 -> review
    expect(assessment.profile.score).toBe(50);
    expect(assessment.decision).toBe("review");
    expect(assessment.hitRuleIds).toEqual(["mismatched_geo_wallet_reuse", "chargeback_history"]);
  });

  it("exposes configured rules and thresholds", () => {
    const engine = new RuleEngine();
    expect(engine.getRules().length).toBe(5);
    expect(engine.getThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });
});
