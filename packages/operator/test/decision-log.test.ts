import { describe, expect, it } from "vitest";
import {
  DecisionLog, GENESIS_HASH, chainDecision, digest, verifyChain, type DecisionInput, type DecisionRecord,
} from "../src/decision-log.js";
import { canonicalJson, fromJsonValue, toJsonValue } from "../src/json.js";

const input = (n: number, overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  id: `dec_${n}`,
  orgId: "org_1",
  eventRef: `evt_${n}`,
  model: "heuristic-v1",
  inputsDigest: digest({ n }),
  toolCalls: [{ name: "get_treasury_state", input: {}, output: { operating: 10n } }],
  policyVerdict: { decision: "allow", reasons: [], spentToday: 5n },
  rationale: `decision ${n}`,
  alternatives: ["defer"],
  confidence: 0.9,
  outcome: "executed",
  createdAt: `2026-10-01T00:00:0${n}.000Z`,
  ...overrides,
});

function buildLog(count: number): DecisionLog {
  let log = new DecisionLog();
  for (let i = 0; i < count; i++) log = log.append(input(i));
  return log;
}

describe("canonical JSON", () => {
  it("is key-order independent and round-trips bigints", () => {
    expect(canonicalJson({ b: 1, a: [2n, { d: undefined, c: "x" }] })).toBe(canonicalJson({ a: [2n, { c: "x" }], b: 1 }));
    const value = { amount: 123n, nested: [1n, { x: 2n }], at: new Date("2026-01-01T00:00:00Z") };
    expect(fromJsonValue(JSON.parse(JSON.stringify(toJsonValue(value))))).toEqual({ ...value, at: "2026-01-01T00:00:00.000Z" });
  });

  it("rejects values JSON cannot represent", () => {
    expect(() => toJsonValue(Number.NaN)).toThrow(TypeError);
    expect(() => toJsonValue(() => 1)).toThrow(TypeError);
  });
});

describe("decision log", () => {
  it("chains records from the genesis hash", () => {
    const log = buildLog(3);
    const [a, b, c] = log.records as [DecisionRecord, DecisionRecord, DecisionRecord];
    expect(a.prevHash).toBe(GENESIS_HASH);
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);
    expect(c.seq).toBe(2);
    expect(a.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(log.verify()).toEqual({ valid: true, checked: 3 });
  });

  it("is deterministic", () => {
    expect(buildLog(2).head?.hash).toBe(buildLog(2).head?.hash);
  });

  it("append does not mutate the previous log", () => {
    const one = buildLog(1);
    const two = one.append(input(1));
    expect(one.records).toHaveLength(1);
    expect(two.records).toHaveLength(2);
    expect(Object.isFrozen(two.records)).toBe(true);
  });

  it("detects an edited field", () => {
    const records = [...buildLog(3).records];
    records[1] = { ...(records[1] as DecisionRecord), rationale: "rewritten after the fact" };
    expect(verifyChain(records)).toMatchObject({ valid: false, brokenAt: 1, reason: expect.stringMatching(/hash/) });
  });

  it("detects an edited nested bigint", () => {
    const records = [...buildLog(2).records];
    const r = records[0] as DecisionRecord;
    records[0] = { ...r, policyVerdict: { decision: "allow", reasons: [], spentToday: 6n } };
    expect(verifyChain(records).brokenAt).toBe(0);
  });

  it("detects deletion, reordering and re-hashing without relinking", () => {
    const records = [...buildLog(4).records];
    expect(verifyChain([records[0]!, records[2]!, records[3]!]).brokenAt).toBe(1);
    expect(verifyChain([records[1]!, records[0]!]).brokenAt).toBe(0);
    const forged = chainDecision(records[0]!, input(9, { rationale: "forged" }));
    expect(verifyChain([records[0]!, forged, records[2]!]).brokenAt).toBe(2);
  });

  it("detects a record whose prevHash was swapped", () => {
    const records = [...buildLog(2).records];
    records[1] = { ...(records[1] as DecisionRecord), prevHash: GENESIS_HASH };
    expect(verifyChain(records)).toMatchObject({ valid: false, brokenAt: 1, reason: expect.stringMatching(/prevHash/) });
  });

  it("verifies an empty chain", () => {
    expect(new DecisionLog().verify()).toEqual({ valid: true, checked: 0 });
    expect(new DecisionLog().head).toBeNull();
  });
});
