import { describe, expect, it } from "vitest";
import type { OperatorEvent } from "../src/events.js";
import { HeuristicOperator, type HeuristicContext } from "../src/heuristic.js";
import { sumBuckets } from "../src/types.js";
import { POLICY, STRANGER, T0, U, VENDOR, buckets, snapshot } from "./fixtures.js";

const op = new HeuristicOperator();
const meta = { orgId: "org_1", at: T0.toISOString() };
const ctx = (overrides: Partial<HeuristicContext> = {}): HeuristicContext => ({
  policy: POLICY,
  vault: snapshot({ buckets: buckets({ OPERATING: 2_000n * U, REFUND: 300n * U, YIELD: 400n * U }), unallocated: 1_000n * U }),
  now: T0,
  ...overrides,
});

const revenue: OperatorEvent = { ...meta, id: "e1", type: "revenue.received", amount: 1_000n * U, payer: "0xpayer", paymentRef: "0xtx" };
const bill = (amount: bigint, payee = VENDOR): OperatorEvent => ({ ...meta, id: "e2", type: "bill.due", billId: "bill_1", payee, amount, dueAt: T0.toISOString(), description: "hosting" });
const refund = (amount: bigint): OperatorEvent => ({ ...meta, id: "e3", type: "refund.requested", customer: VENDOR, amount, paymentRef: "p1", reason: "unused" });
const dispute: OperatorEvent = { ...meta, id: "e4", type: "dispute.opened", disputeId: "d1", customer: VENDOR, amount: 50n * U, paymentRef: "p1" };
const tick: OperatorEvent = { ...meta, id: "e5", type: "tick" };

describe("HeuristicOperator", () => {
  it("is deterministic: same input, same output and digest", () => {
    for (const event of [revenue, bill(100n * U), refund(10n * U), dispute, tick]) {
      expect(op.decide(event, ctx())).toEqual(op.decide(event, ctx()));
    }
    expect(op.decide(tick, ctx()).inputsDigest).not.toBe(op.decide(tick, ctx({ now: new Date(T0.getTime() + 1) })).inputsDigest);
  });

  it("allocates revenue exactly", () => {
    const d = op.decide(revenue, ctx());
    expect(d).toMatchObject({ eventRef: "e1", model: "heuristic-v1" });
    const action = d.proposals[0]!.action;
    expect(action.kind).toBe("allocate");
    if (action.kind === "allocate") expect(sumBuckets(action.amounts)).toBe(1_000n * U);
    expect(d.proposals[0]!.alternativesConsidered.length).toBeGreaterThan(0);
  });

  it("defers revenue that has not landed yet", () => {
    const d = op.decide(revenue, ctx({ vault: snapshot({ unallocated: 10n * U }) }));
    expect(d.proposals[0]!.action).toMatchObject({ kind: "defer" });
  });

  it("pays an allowed bill, escalates a large one, escalates an unknown payee", () => {
    const small = op.decide(bill(100n * U), ctx()).proposals[0]!;
    expect(small.action).toMatchObject({ kind: "payout", bucket: "OPERATING", amount: 100n * U });
    expect(small.verdict?.decision).toBe("allow");

    const large = op.decide(bill(800n * U), ctx()).proposals[0]!;
    expect(large.action.kind).toBe("payout");
    expect(large.verdict).toMatchObject({ decision: "escalate", escalation: "vault" });

    const unknown = op.decide(bill(100n * U, STRANGER), ctx()).proposals[0]!;
    expect(unknown.action).toMatchObject({ kind: "escalate", reason: "not_allowlisted" });
    if (unknown.action.kind === "escalate") expect(unknown.action.subject?.kind).toBe("payout");
  });

  it("defers when the daily cap is used up and declines blocked counterparties", () => {
    const spends = [0, 1, 2].map(() => ({ amount: 500n * U, at: T0.toISOString() }));
    const capped = op.decide(bill(10n * U), ctx({ vault: { ...ctx().vault, spends } })).proposals[0]!;
    expect(capped.action).toMatchObject({ kind: "defer", reason: "daily_cap_exceeded" });

    const blocked = op.decide(bill(10n * U), ctx({ risk: "block" })).proposals[0]!;
    expect(blocked.action).toMatchObject({ kind: "decline" });
  });

  it("refunds from REFUND and escalates when the bucket is short", () => {
    expect(op.decide(refund(10n * U), ctx()).proposals[0]!.action).toMatchObject({ kind: "refund", amount: 10n * U });
    expect(op.decide(refund(400n * U), ctx()).proposals[0]!.action).toMatchObject({ kind: "escalate", reason: "insufficient_bucket" });
  });

  it("escalates disputes with a refund subject", () => {
    const p = op.decide(dispute, ctx()).proposals[0]!;
    expect(p.action).toMatchObject({ kind: "escalate", reason: "dispute opened", subject: { kind: "refund" } });
    expect(p.confidence).toBeLessThan(0.9);
  });

  it("on tick: allocates stragglers, flags low float, sweeps toward yield target", () => {
    const policy = { ...POLICY, minFloat: 3_000n * U, yieldTarget: 250n * U };
    const vault = { ...ctx().vault, yieldEnabled: true, yieldDeployed: 100n * U };
    const kinds = op.decide(tick, ctx({ policy, vault })).proposals.map((p) => p.action);
    expect(kinds.map((a) => a.kind)).toEqual(["allocate", "escalate", "sweep_to_yield"]);
    expect(kinds[2]).toMatchObject({ amount: 150n * U });
  });

  it("on tick with nothing to do, defers; when paused, always defers", () => {
    const idle = ctx({ vault: snapshot({ buckets: buckets({ OPERATING: 1n }) }) });
    expect(op.decide(tick, idle).proposals.map((p) => p.action.kind)).toEqual(["defer"]);
    const paused = ctx({ vault: { ...ctx().vault, paused: true } });
    for (const event of [revenue, bill(1n), tick]) {
      expect(op.decide(event, paused).proposals[0]!.action).toMatchObject({ kind: "defer", reason: "vault paused" });
    }
  });
});
