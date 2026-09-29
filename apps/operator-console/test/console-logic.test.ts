import { describe, expect, it } from "vitest";
import { parseBillForm } from "../lib/bill-form";
import { decisionTxHashes, describeAction, latestDecisions, traceSteps } from "../lib/decisions";
import { hasDrift, policyRows, sameUsdc } from "../lib/policy-view";
import { createLimiter, clientKey } from "../lib/throttle";
import type { DecisionView, OperatorStateView, PolicyResponse } from "../lib/types";

const VENDOR = "0x00000000000000000000000000000000007e2d02";

describe("bill form", () => {
  it("validates manual bills and normalises the due date", () => {
    const ok = parseBillForm({ mode: "manual", payee: VENDOR, amountUsdc: "120.5", dueDate: "2026-10-10", description: " Hosting ", vendor: "" });
    expect(ok).toEqual({ ok: true, value: { payee: VENDOR, amountUsdc: "120.5", dueAt: "2026-10-10T00:00:00.000Z", description: "Hosting" } });
    const bad = parseBillForm({ mode: "manual", payee: "bob", amountUsdc: "0", dueDate: "tomorrow", description: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(Object.keys(bad.errors).sort()).toEqual(["amountUsdc", "description", "dueDate", "payee"]);
  });

  it("accepts pasted invoice text within limits", () => {
    expect(parseBillForm({ mode: "invoice", invoiceText: "Invoice 42" })).toEqual({ ok: true, value: { invoiceText: "Invoice 42" } });
    expect(parseBillForm({ mode: "invoice", invoiceText: "  " }).ok).toBe(false);
    expect(parseBillForm({ mode: "invoice", invoiceText: "x".repeat(50_001) }).ok).toBe(false);
  });
});

const decision = (seq: number): DecisionView => ({
  id: `dec_${seq}`, orgId: "o", eventRef: `e${seq}`, model: "heuristic", inputsDigest: "0x", toolCalls: [], policyVerdict: null,
  rationale: "", alternatives: [], confidence: 1, outcome: "executed", createdAt: "2026-10-07T00:00:00.000Z", seq, prevHash: "0x", hash: "0x",
});

describe("decision helpers", () => {
  it("pages through the chain and returns the newest first", async () => {
    const chain = Array.from({ length: 1203 }, (_, i) => decision(i));
    const calls: number[] = [];
    const api = {
      decisions: async ({ afterSeq = -1, limit = 100 } = {}) => {
        calls.push(afterSeq);
        return chain.filter((d) => d.seq > afterSeq).slice(0, limit);
      },
    };
    const latest = await latestDecisions(api, 3);
    expect(latest.map((d) => d.seq)).toEqual([1202, 1201, 1200]);
    expect(calls).toEqual([-1, 499, 999]);
  });

  it("collects tx hashes, renders traces and summarises actions", () => {
    expect(decisionTxHashes({ txHash: "0xa", txHashes: ["0xa", "0xb"] })).toEqual(["0xa", "0xb"]);
    expect(decisionTxHashes({})).toEqual([]);
    const steps = traceSteps([{ name: "get_treasury_state", input: {}, output: { ok: true } }, { name: "escalate", input: { reason: "x" } }]);
    expect(steps[0]).toMatchObject({ index: 1, name: "get_treasury_state", output: '{\n  "ok": true\n}' });
    expect(steps[1]?.output).toBeNull();
    expect(describeAction({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: "120000000" })).toBe(`Pay 120 USDC from OPERATING to ${VENDOR}`);
    expect(describeAction({ kind: "refund", to: VENDOR, amount: "5000000" })).toBe(`Refund 5 USDC to ${VENDOR}`);
    expect(describeAction(undefined)).toBe("No action");
  });
});

const policyRes = (drift: string[] = [], vault: string | null = "0x00000000000000000000000000000000000000f1"): PolicyResponse => ({
  policy: {
    split: { OPERATING: 7000, YIELD: 2000, REFUND: 1000 }, taxRateBps: 2500, perTxCap: "1000", dailyCap: "1500", escalateAbove: "500",
    minFloat: "0", yieldTarget: "0", allowlist: [VENDOR], maxX402PerDay: 20,
  },
  drift, executor: "circle-dcw", engine: "claude", vault,
});
const state = (dailyCap: string): OperatorStateView => ({
  orgId: "o", buckets: { OPERATING: "0", TAX: "0", YIELD: "0", REFUND: "0" }, total: "0", unallocated: "0", pendingReserved: "0",
  yieldDeployed: "0", yieldEnabled: false, paused: false, spentToday: "0", caps: { perTxCap: "1000.000000", dailyCap, escalateAbove: "500" },
  dailyCapUsed: 0, pendingEscalations: 0, asOf: "", executor: "circle-dcw", vault: null, explorerUrl: "",
});

describe("policy drift view", () => {
  it("compares USDC strings exactly", () => {
    expect(sameUsdc("1000", "1000.000000")).toBe(true);
    expect(sameUsdc("1000.1", "1000.10")).toBe(true);
    expect(sameUsdc("1000", "1000.000001")).toBe(false);
  });

  it("marks matching caps and allowlist in sync", () => {
    const rows = policyRows(policyRes(), state("1500"));
    expect(rows.slice(0, 4).map((r) => r.status)).toEqual(["match", "match", "match", "match"]);
    expect(rows.find((r) => r.label === "Tax reserve")).toMatchObject({ offChain: "25%", status: "off_chain_only" });
    expect(hasDrift(policyRes(), rows)).toBe(false);
  });

  it("flags cap and allowlist drift", () => {
    const res = policyRes([`${VENDOR} is not allowlisted on-chain`]);
    const rows = policyRows(res, state("2000"));
    expect(rows.find((r) => r.label === "Daily cap")).toMatchObject({ status: "drift", onChain: "2,000.00 USDC" });
    expect(rows.find((r) => r.label.includes(VENDOR))).toMatchObject({ status: "drift", onChain: "not allowlisted" });
    expect(hasDrift(res, rows)).toBe(true);
  });

  it("reports unknown on-chain values when state is unavailable", () => {
    const rows = policyRows(policyRes([], null), null);
    expect(rows[0]).toMatchObject({ onChain: "unavailable", status: "unknown" });
  });
});

describe("attempt limiter", () => {
  it("allows the budget per window and resets after it", () => {
    const limiter = createLimiter(2, 1000);
    expect([limiter.hit("a", 0), limiter.hit("a", 10), limiter.hit("a", 20), limiter.hit("b", 20)]).toEqual([true, true, false, true]);
    expect(limiter.hit("a", 1001)).toBe(true);
  });

  it("keys on the first forwarded address", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(clientKey(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(h({}))).toBe("unknown");
  });
});
