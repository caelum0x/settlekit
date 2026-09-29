import { describe, expect, it } from "vitest";
import { evaluate, validatePolicy, type SpendRequest } from "../src/policy.js";
import { POLICY, STRANGER, T0, U, VENDOR, buckets, snapshot } from "./fixtures.js";

const vault = snapshot({ buckets: buckets({ OPERATING: 2_000n * U, REFUND: 500n * U }) });
const pay = (amount: bigint, extra: Partial<SpendRequest> = {}): SpendRequest => ({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount, ...extra });

describe("evaluate: off-chain gates (stricter than the vault)", () => {
  it("escalates off-chain when the payment would breach the operating float", () => {
    const v = evaluate({ ...POLICY, minFloat: 1_700n * U }, pay(400n * U), { now: T0, vault });
    expect(v).toMatchObject({ decision: "escalate", escalation: "offchain", reasons: ["below_min_float"] });
  });

  it("maps risk and compliance verdicts", () => {
    expect(evaluate(POLICY, pay(10n * U), { now: T0, vault, risk: "review" })).toMatchObject({ decision: "escalate", reasons: ["risk_review"] });
    expect(evaluate(POLICY, pay(10n * U), { now: T0, vault, risk: "block" })).toMatchObject({ decision: "deny", reasons: ["risk_block"] });
    expect(evaluate(POLICY, pay(10n * U), { now: T0, vault, complianceSignals: [{ type: "wallet_risk", severity: "medium" }] }).reasons).toEqual(["compliance_review"]);
    expect(evaluate(POLICY, pay(10n * U), { now: T0, vault, complianceSignals: [{ type: "sanctions_match", severity: "low" }] })).toMatchObject({ decision: "deny", reasons: ["compliance_block"] });
    expect(evaluate(POLICY, pay(10n * U), { now: T0, vault, risk: "allow", complianceSignals: [] }).decision).toBe("allow");
  });

  it("limits x402 purchases per day", () => {
    const req = pay(1n * U, { kind: "x402" });
    expect(evaluate(POLICY, req, { now: T0, vault, x402PurchasesToday: 19 }).decision).toBe("allow");
    expect(evaluate(POLICY, req, { now: T0, vault, x402PurchasesToday: 20 })).toMatchObject({ decision: "escalate", reasons: ["x402_daily_limit"] });
  });

  it("lists deny reasons in vault check order and escalation never overrides a deny", () => {
    const v = evaluate(POLICY, { kind: "payout", bucket: "TAX", to: STRANGER, amount: 5_000n * U }, { now: T0, vault: { ...vault, paused: true } });
    expect(v.reasons).toEqual(["paused", "tax_locked", "not_allowlisted", "per_tx_cap_exceeded", "insufficient_bucket"]);
    expect(v.decision).toBe("deny");
  });

  it("treats an empty allowlist as allowing nobody (unlike treasury's allow-any)", () => {
    expect(evaluate({ ...POLICY, allowlist: [] }, pay(1n * U), { now: T0, vault }).reasons).toEqual(["not_allowlisted"]);
  });

  it("matches allowlist case-insensitively and reports spend in window", () => {
    const v = evaluate(POLICY, pay(1n * U, { to: VENDOR.toUpperCase().replace("0X", "0x") }), {
      now: T0,
      vault: { ...vault, spends: [{ amount: 3n * U, at: T0.toISOString() }, { amount: 9n * U, at: "2020-01-01T00:00:00Z" }] },
    });
    expect(v).toMatchObject({ decision: "allow", spentToday: 3n * U });
  });

  it("does not mutate inputs", () => {
    const frozen = Object.freeze({ ...POLICY, allowlist: Object.freeze([VENDOR]) });
    expect(() => evaluate(frozen, pay(1n), { now: T0, vault: Object.freeze(vault) })).not.toThrow();
  });
});

describe("validatePolicy", () => {
  it("accepts the fixture policy", () => {
    expect(validatePolicy(POLICY)).toEqual([]);
  });

  it("reports every problem, with the vault's cap relations", () => {
    const errors = validatePolicy({
      ...POLICY,
      split: { OPERATING: 5_000, YIELD: 5_000, REFUND: 5_000 },
      taxRateBps: 1.5,
      perTxCap: 0n,
      dailyCap: -1n,
      escalateAbove: 10n,
      minFloat: -1n,
      maxX402PerDay: -1,
    });
    expect(errors).toHaveLength(7);
  });
});
