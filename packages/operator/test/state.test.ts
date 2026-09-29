import { describe, expect, it } from "vitest";
import { buildOperatorState, spentOn, utcDay } from "../src/state.js";
import type { VaultSnapshot } from "../src/types.js";

const U = 1_000_000n;
const NOW = new Date("2026-10-04T12:00:00.000Z");

const snapshot = (over: Partial<VaultSnapshot> = {}): VaultSnapshot => ({
  buckets: { OPERATING: 700n * U, TAX: 250n * U, YIELD: 50n * U, REFUND: 25n * U },
  unallocated: 100n * U,
  pendingReserved: 600n * U,
  yieldDeployed: 10n * U,
  yieldEnabled: false,
  paused: false,
  allowlist: [],
  spends: [
    { amount: 120n * U, at: "2026-10-04T01:00:00.000Z" },
    { amount: 300n * U, at: "2026-10-04T23:59:59.000Z" },
    { amount: 999n * U, at: "2026-10-03T23:59:59.000Z" },
  ],
  ...over,
});

describe("operator state", () => {
  it("counts only spends in the current UTC day, like OperatorVault.currentDay()", () => {
    expect(utcDay(NOW)).toBe(Math.floor(NOW.getTime() / 86_400_000));
    expect(spentOn(snapshot(), NOW)).toBe(420n * U);
  });

  it("projects buckets, totals, caps and cap usage as USDC strings", () => {
    const state = buildOperatorState({
      orgId: "org_1",
      snapshot: snapshot(),
      caps: { perTxCap: 1000n * U, dailyCap: 1500n * U, escalateAbove: 500n * U },
      pendingEscalations: 2,
      now: NOW,
    });
    expect(state).toMatchObject({
      orgId: "org_1",
      buckets: { OPERATING: "700", TAX: "250", YIELD: "50", REFUND: "25" },
      total: "1725",
      unallocated: "100",
      pendingReserved: "600",
      yieldDeployed: "10",
      spentToday: "420",
      caps: { perTxCap: "1000", dailyCap: "1500", escalateAbove: "500" },
      dailyCapUsed: 0.28,
      pendingEscalations: 2,
      asOf: NOW.toISOString(),
    });
  });

  it("clamps cap usage to 1 and handles a zero daily cap", () => {
    const over = buildOperatorState({ orgId: "o", snapshot: snapshot(), caps: { perTxCap: U, dailyCap: 100n * U, escalateAbove: 0n }, pendingEscalations: 0, now: NOW });
    expect(over.dailyCapUsed).toBe(1);
    const zero = buildOperatorState({ orgId: "o", snapshot: snapshot(), caps: { perTxCap: U, dailyCap: 0n, escalateAbove: 0n }, pendingEscalations: 0, now: NOW });
    expect(zero.dailyCapUsed).toBe(0);
  });
});
