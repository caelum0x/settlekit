import { describe, expect, it } from "vitest";
import {
  detectGroundingForText,
  getAgentConsoleContext,
} from "../lib/data";

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

describe("getAgentConsoleContext", () => {
  it("publishes the seeded agent-services for discovery", () => {
    const ctx = getAgentConsoleContext();
    expect(ctx.services.length).toBeGreaterThan(0);
    expect(ctx.totals.servicesDiscovered).toBe(ctx.services.length);
    for (const s of ctx.services) {
      expect(s.paymentProtocol).toBe("x402");
      expect(["arc", "base"]).toContain(s.network);
      expect(s.priceUsdc).toMatch(DECIMAL_RE);
    }
  });

  it("produces parseable USDC spend per agent", () => {
    const ctx = getAgentConsoleContext();
    expect(ctx.agents.length).toBeGreaterThan(0);
    for (const a of ctx.agents) {
      expect(a.spent.amount).toMatch(DECIMAL_RE);
      expect(Number.isNaN(Number(a.spent.amount))).toBe(false);
      expect(a.budgetUsedPct).toBeGreaterThanOrEqual(0);
      expect(a.budgetUsedPct).toBeLessThanOrEqual(1);
    }
  });

  it("aggregates a total x402 spend across agents", () => {
    const ctx = getAgentConsoleContext();
    expect(ctx.totals.totalSpend.amount).toMatch(DECIMAL_RE);
    expect(Number(ctx.totals.totalSpend.amount)).toBeGreaterThan(0);
  });

  it("computes a recursive royalty distribution with depth-0 and depth>0 legs", () => {
    const ctx = getAgentConsoleContext();
    const legs = ctx.citations.legs;
    expect(legs.length).toBeGreaterThan(0);
    expect(legs.some((l) => l.depth === 0)).toBe(true);
    expect(legs.some((l) => l.depth > 0)).toBe(true);
    for (const l of legs) {
      expect(l.amount.amount).toMatch(DECIMAL_RE);
    }
  });

  it("grounds the seeded worked example and issues a signed proof", () => {
    const ctx = getAgentConsoleContext();
    expect(ctx.citations.grounded).toBe(true);
    expect(ctx.citations.matches.length).toBeGreaterThan(0);
    expect(ctx.citations.proof.signature.length).toBeGreaterThan(0);
    expect(ctx.citations.proof.agent).toBe("agent_atlas");
  });

  it("is deterministic across renders except for randomly-generated ids", () => {
    // createSource() mints a random source id per call and issueCitationProof()
    // a random nonce/signature — both are domain-level randomness. Everything
    // derived from the fixed CLOCK + seeds (amounts, depths, shares, titles) is
    // stable, so we compare legs on their value-bearing fields, not the id.
    const a = getAgentConsoleContext();
    const b = getAgentConsoleContext();
    const stableLegs = (legs: typeof a.citations.legs) =>
      legs.map(({ sourceId, ...rest }) => rest);
    expect(a.totals.totalSpend.amount).toBe(b.totals.totalSpend.amount);
    expect(stableLegs(a.citations.legs)).toEqual(stableLegs(b.citations.legs));
    expect(a.citations.tollOwedUsdc).toBe(b.citations.tollOwedUsdc);
    expect(a.services.map((s) => s.ratingAverage)).toEqual(
      b.services.map((s) => s.ratingAverage),
    );
  });
});

describe("detectGroundingForText", () => {
  it("detects grounding for corpus-derived text", () => {
    const res = detectGroundingForText(
      "Royalties should follow a work through every hand that made it, and when settlement is sub-cent and gas-free a citation can pay its source automatically.",
    );
    expect(res.grounded).toBe(true);
    expect(res.matches.length).toBeGreaterThan(0);
    expect(res.quoteUsdc).toMatch(DECIMAL_RE);
  });

  it("returns no grounding for unrelated text", () => {
    const res = detectGroundingForText("The quick brown fox jumps over the lazy dog repeatedly.");
    expect(res.grounded).toBe(false);
    expect(res.matches.length).toBe(0);
  });
});
