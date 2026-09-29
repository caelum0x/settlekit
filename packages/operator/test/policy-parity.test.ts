/**
 * Parity table: the same cases as contracts/test/OperatorVault.t.sol, run
 * against both the pure policy (`evaluate`) and the vault simulation
 * (`LocalExecutor`). Both must agree with the forge expectation.
 */
import { describe, expect, it } from "vitest";
import { LocalExecutor } from "../src/local-executor.js";
import { evaluate, VAULT_ERROR, type DenyReason } from "../src/policy.js";
import { VaultError } from "../src/executor.js";
import type { Bucket, BucketBalances, SpendRecord } from "../src/types.js";
import {
  DAILY, DAY_MS, ESCALATE_ABOVE, PER_TX, POLICY, STRANGER, T0, U, VENDOR, buckets, nextUtcDay, snapshot,
} from "./fixtures.js";

type Expected = "paid" | "escalated" | string;

interface ParityCase {
  readonly name: string;
  readonly buckets: BucketBalances;
  readonly priorSpends?: readonly SpendRecord[];
  readonly paused?: boolean;
  readonly now?: Date;
  readonly bucket: Bucket;
  readonly to: string;
  readonly amount: bigint;
  readonly expected: Expected;
}

const endOfDay = new Date(nextUtcDay(T0).getTime() - 1000);
const fullDay = (at: Date): SpendRecord[] => [0, 1, 2].map(() => ({ amount: 500n * U, at: at.toISOString() }));

const CASES: readonly ParityCase[] = [
  { name: "pay within caps", buckets: buckets({ OPERATING: 2_000n * U }), bucket: "OPERATING", to: VENDOR, amount: 400n * U, expected: "paid" },
  { name: "per-tx cap", buckets: buckets({ OPERATING: 5_000n * U }), bucket: "OPERATING", to: VENDOR, amount: PER_TX + 1n, expected: "PerTxCapExceeded" },
  { name: "daily cap reached", buckets: buckets({ OPERATING: 5_000n * U }), priorSpends: fullDay(T0), bucket: "OPERATING", to: VENDOR, amount: 1n, expected: "DailyCapExceeded" },
  { name: "daily window rolls over at UTC midnight", buckets: buckets({ OPERATING: 5_000n * U }), priorSpends: fullDay(T0), now: nextUtcDay(T0), bucket: "OPERATING", to: VENDOR, amount: 500n * U, expected: "paid" },
  { name: "UTC day, not rolling 24h", buckets: buckets({ OPERATING: 5_000n * U }), priorSpends: fullDay(endOfDay), now: new Date(endOfDay.getTime() + 1000), bucket: "OPERATING", to: VENDOR, amount: 500n * U, expected: "paid" },
  { name: "allowlist", buckets: buckets({ OPERATING: 1_000n * U }), bucket: "OPERATING", to: STRANGER, amount: 10n * U, expected: "NotAllowlisted" },
  { name: "TAX never operator-spendable", buckets: buckets({ TAX: 1_000n * U }), bucket: "TAX", to: VENDOR, amount: 10n * U, expected: "TaxLocked" },
  { name: "insufficient bucket", buckets: buckets({ OPERATING: 100n * U, REFUND: 50n * U }), bucket: "REFUND", to: VENDOR, amount: 60n * U, expected: "InsufficientBucket" },
  { name: "zero amount", buckets: buckets({ OPERATING: 100n * U }), bucket: "OPERATING", to: VENDOR, amount: 0n, expected: "ZeroAmount" },
  { name: "above threshold escalates", buckets: buckets({ OPERATING: 2_000n * U }), bucket: "OPERATING", to: VENDOR, amount: 800n * U, expected: "escalated" },
  { name: "escalation skips daily cap", buckets: buckets({ OPERATING: 5_000n * U }), priorSpends: fullDay(T0), bucket: "OPERATING", to: VENDOR, amount: 900n * U, expected: "escalated" },
  { name: "per-tx cap beats escalation", buckets: buckets({ OPERATING: 5_000n * U }), bucket: "OPERATING", to: VENDOR, amount: 1_001n * U, expected: "PerTxCapExceeded" },
  { name: "paused", buckets: buckets({ OPERATING: 1_000n * U }), paused: true, bucket: "OPERATING", to: VENDOR, amount: 10n * U, expected: "IsPaused" },
  { name: "exactly at escalate threshold pays", buckets: buckets({ OPERATING: 1_000n * U }), bucket: "OPERATING", to: VENDOR, amount: ESCALATE_ABOVE, expected: "paid" },
  { name: "exactly fills daily cap", buckets: buckets({ OPERATING: 5_000n * U }), priorSpends: fullDay(T0).slice(0, 2), bucket: "OPERATING", to: VENDOR, amount: DAILY - 1_000n * U, expected: "paid" },
];

function policyOutcome(c: ParityCase): Expected {
  const verdict = evaluate(
    POLICY,
    { kind: "payout", bucket: c.bucket, to: c.to, amount: c.amount },
    { now: c.now ?? T0, vault: snapshot({ buckets: c.buckets, spends: c.priorSpends ?? [], paused: c.paused ?? false }) },
  );
  if (verdict.decision === "allow") return "paid";
  if (verdict.decision === "escalate") {
    expect(verdict.escalation).toBe("vault");
    return "escalated";
  }
  return VAULT_ERROR[verdict.reasons[0] as DenyReason] ?? String(verdict.reasons[0]);
}

async function executorOutcome(c: ParityCase): Promise<Expected> {
  let now = T0;
  const exec = new LocalExecutor({ caps: { perTxCap: PER_TX, dailyCap: DAILY, escalateAbove: ESCALATE_ABOVE }, allowlist: [VENDOR], now: () => now });
  const prior = c.priorSpends ?? [];
  const priorTotal = prior.reduce((a, s) => a + s.amount, 0n);
  const funded = { ...c.buckets, OPERATING: c.buckets.OPERATING + priorTotal };
  exec.deposit(Object.values(funded).reduce((a, b) => a + b, 0n));
  await exec.allocate("0x01", funded);
  for (const s of prior) {
    now = new Date(s.at);
    await exec.pay("0x02", "OPERATING", VENDOR, s.amount);
  }
  now = c.now ?? T0;
  if (c.paused) await exec.pause();
  try {
    const result = await exec.pay("0x03", c.bucket, c.to, c.amount);
    return result.status;
  } catch (error: unknown) {
    if (error instanceof VaultError) return error.code;
    throw error;
  }
}

describe("policy / vault parity (mirrors OperatorVault.t.sol)", () => {
  it.each(CASES)("$name -> $expected", async (c) => {
    expect(policyOutcome(c)).toBe(c.expected);
    expect(await executorOutcome(c)).toBe(c.expected);
  });

  it("covers every vault revert the operator can hit on pay", () => {
    const covered = new Set(CASES.map((c) => c.expected));
    for (const code of Object.values(VAULT_ERROR)) expect(covered.has(code as string)).toBe(true);
  });

  it("day boundary constant matches the vault (timestamp / 1 days)", () => {
    expect(Math.floor(nextUtcDay(T0).getTime() / DAY_MS)).toBe(Math.floor(1_760_000_000 / 86_400) + 1);
  });
});
