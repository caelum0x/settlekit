import { describe, expect, it } from "vitest";
import {
  evaluate,
  recordSpend,
  spentInDay,
  toTransferIntent,
  TreasuryPolicyError,
} from "../src/index.js";
import type { TreasuryPolicy, TreasuryState, TransferRequest } from "../src/index.js";

const usdc = (amount: string) => ({ amount, currency: "USDC" as const });

const POLICY: TreasuryPolicy = {
  requiredApprovals: 2,
  dailyLimit: usdc("1000"),
  destinationAllowlist: ["0xAllowed", "0xSecond"],
};

const EMPTY: TreasuryState = { spends: [] };

const baseRequest: TransferRequest = {
  sourceWalletId: "wallet_1",
  destination: "0xallowed",
  amount: usdc("100"),
  approvals: ["alice", "bob"],
};

const NOW = new Date("2026-06-16T12:00:00Z");

describe("evaluate", () => {
  it("allows a compliant request", () => {
    const result = evaluate(POLICY, EMPTY, baseRequest, NOW);
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.remainingAfter).toEqual(usdc("900"));
  });

  it("denies when approvals are below the threshold", () => {
    const result = evaluate(POLICY, EMPTY, { ...baseRequest, approvals: ["alice"] }, NOW);
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("insufficient_approvals");
  });

  it("de-duplicates repeated approvers before counting", () => {
    const result = evaluate(
      POLICY,
      EMPTY,
      { ...baseRequest, approvals: ["alice", "alice"] },
      NOW,
    );
    expect(result.reasons).toContain("insufficient_approvals");
  });

  it("denies destinations not on the allowlist (case-insensitive match passes)", () => {
    const denied = evaluate(POLICY, EMPTY, { ...baseRequest, destination: "0xEvil" }, NOW);
    expect(denied.reasons).toContain("destination_not_allowed");

    const allowed = evaluate(POLICY, EMPTY, { ...baseRequest, destination: "0xALLOWED" }, NOW);
    expect(allowed.reasons).not.toContain("destination_not_allowed");
  });

  it("allows any destination when no allowlist is configured", () => {
    const open: TreasuryPolicy = { requiredApprovals: 2, dailyLimit: usdc("1000") };
    const result = evaluate(open, EMPTY, { ...baseRequest, destination: "0xanything" }, NOW);
    expect(result.reasons).not.toContain("destination_not_allowed");
  });

  it("enforces the daily limit using only same-UTC-day spend", () => {
    const state: TreasuryState = {
      spends: [
        { amount: usdc("950"), at: "2026-06-16T01:00:00Z" }, // same day
        { amount: usdc("500"), at: "2026-06-15T23:59:59Z" }, // previous day, ignored
      ],
    };
    expect(spentInDay(state, NOW)).toEqual(usdc("950"));

    // 950 + 100 = 1050 > 1000 -> denied
    const denied = evaluate(POLICY, state, baseRequest, NOW);
    expect(denied.reasons).toContain("daily_limit_exceeded");

    // A 50 request fits exactly at the limit (boundary is inclusive).
    const atLimit = evaluate(POLICY, state, { ...baseRequest, amount: usdc("50") }, NOW);
    expect(atLimit.allowed).toBe(true);
    expect(atLimit.remainingAfter).toEqual(usdc("0"));
  });

  it("resets the window on a new UTC day", () => {
    const state: TreasuryState = {
      spends: [{ amount: usdc("950"), at: "2026-06-15T12:00:00Z" }],
    };
    const nextDay = new Date("2026-06-16T00:00:01Z");
    const result = evaluate(POLICY, state, baseRequest, nextDay);
    expect(result.spentInWindow).toEqual(usdc("0"));
    expect(result.allowed).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    const result = evaluate(POLICY, EMPTY, { ...baseRequest, amount: usdc("0") }, NOW);
    expect(result.reasons).toContain("invalid_amount");
  });

  it("accumulates multiple denial reasons", () => {
    const result = evaluate(
      POLICY,
      EMPTY,
      { destination: "0xEvil", amount: usdc("0"), approvals: [], sourceWalletId: "w" },
      NOW,
    );
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "invalid_amount",
        "insufficient_approvals",
        "destination_not_allowed",
      ]),
    );
  });
});

describe("recordSpend", () => {
  it("appends a spend immutably and feeds the next window", () => {
    const after = recordSpend(EMPTY, usdc("600"), NOW);
    expect(EMPTY.spends).toHaveLength(0); // original untouched
    expect(after.spends).toHaveLength(1);
    expect(spentInDay(after, NOW)).toEqual(usdc("600"));
  });
});

describe("toTransferIntent", () => {
  it("produces a validated intent for an allowed request", () => {
    const intent = toTransferIntent(POLICY, EMPTY, baseRequest, NOW);
    expect(intent).toMatchObject({
      sourceWalletId: "wallet_1",
      destination: "0xallowed",
      amount: usdc("100"),
      approvals: ["alice", "bob"],
      createdAt: NOW.toISOString(),
    });
  });

  it("throws a TreasuryPolicyError with reasons for a denied request", () => {
    try {
      toTransferIntent(POLICY, EMPTY, { ...baseRequest, approvals: ["alice"] }, NOW);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TreasuryPolicyError);
      expect((err as TreasuryPolicyError).reasons).toContain("insufficient_approvals");
    }
  });
});
