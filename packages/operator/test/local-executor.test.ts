import { describe, expect, it } from "vitest";
import { proposal } from "../src/actions.js";
import { VaultError, executeProposal } from "../src/executor.js";
import { LocalExecutor } from "../src/local-executor.js";
import { ESCALATION_TTL_MS } from "../src/escalation.js";
import type { PolicyVerdict } from "../src/policy.js";
import { DAILY, ESCALATE_ABOVE, PER_TX, T0, U, VENDOR, buckets } from "./fixtures.js";

const CAPS = { perTxCap: PER_TX, dailyCap: DAILY, escalateAbove: ESCALATE_ABOVE };

async function setup(opts: { yieldEnabled?: boolean } = {}) {
  const clock = { now: T0 };
  const exec = new LocalExecutor({ caps: CAPS, allowlist: [VENDOR], yieldEnabled: opts.yieldEnabled, now: () => clock.now });
  exec.deposit(10_000n * U);
  await exec.allocate("0xa", buckets({ OPERATING: 6_000n * U, TAX: 2_500n * U, YIELD: 1_000n * U, REFUND: 500n * U }));
  return { exec, clock };
}

const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => (e instanceof VaultError ? e.code : String(e)));

describe("LocalExecutor", () => {
  it("allocates only unallocated inflow", async () => {
    const { exec } = await setup();
    const snap = await exec.snapshot();
    expect(snap.unallocated).toBe(0n);
    expect(await code(exec.allocate("0xb", buckets({ OPERATING: 1n })))).toBe("OverAllocation");
    expect(await code(exec.allocate("0xb", buckets({})))).toBe("ZeroAmount");
    expect(await code(exec.allocate("0xb", buckets({ OPERATING: -1n, TAX: 2n })))).toBe("OverAllocation");
    expect(() => exec.deposit(0n)).toThrow(VaultError);
  });

  it("pays, records daily spend and anchors every mutation", async () => {
    const { exec } = await setup();
    const r = await exec.pay("0xd1", "OPERATING", VENDOR, 400n * U);
    expect(r.status).toBe("paid");
    expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(exec.spentToday()).toBe(400n * U);
    expect((await exec.snapshot()).buckets.OPERATING).toBe(5_600n * U);
    expect(exec.anchors.map((a) => a.action)).toEqual(["ALLOCATE", "PAY"]);
    expect(exec.anchors[1]).toEqual({ decisionHash: "0xd1", action: "PAY" });
  });

  it("escalate -> approve executes and counts toward the day", async () => {
    const { exec } = await setup();
    const r = await exec.pay("0xe", "OPERATING", VENDOR, 800n * U);
    expect(r).toMatchObject({ status: "escalated", escalationId: 1 });
    expect((await exec.snapshot()).pendingReserved).toBe(800n * U);
    await exec.approve(1);
    expect(exec.escalation(1)?.status).toBe("Approved");
    expect(exec.spentToday()).toBe(800n * U);
    expect((await exec.snapshot()).pendingReserved).toBe(0n);
    expect(await code(exec.approve(1))).toBe("NotPending");
  });

  it("escalate -> reject restores the bucket; expiry after 72h", async () => {
    const { exec, clock } = await setup();
    await exec.pay("0xe1", "OPERATING", VENDOR, 800n * U);
    await exec.reject(1);
    expect((await exec.snapshot()).buckets.OPERATING).toBe(6_000n * U);

    await exec.pay("0xe2", "OPERATING", VENDOR, 700n * U);
    expect(await code(exec.expire(2))).toBe("EscalationNotExpired");
    clock.now = new Date(T0.getTime() + ESCALATION_TTL_MS + 1000);
    expect(await code(exec.approve(2))).toBe("EscalationExpired");
    await exec.expire(2);
    expect(exec.escalation(2)?.status).toBe("Expired");
    expect((await exec.snapshot()).buckets.OPERATING).toBe(6_000n * U);
  });

  it("approval re-checks the allowlist", async () => {
    const { exec } = await setup();
    await exec.pay("0xe", "OPERATING", VENDOR, 800n * U);
    await exec.setAllowlist("0xf", VENDOR, false);
    expect(await code(exec.approve(1))).toBe("NotAllowlisted");
    await exec.setAllowlist("0xf", VENDOR, true);
    expect(await code(exec.approve(1))).toBe("ok");
  });

  it("pause blocks operator actions and approvals, not rejection", async () => {
    const { exec } = await setup();
    await exec.pay("0xe", "OPERATING", VENDOR, 800n * U);
    await exec.pause();
    expect(await code(exec.pay("0x1", "OPERATING", VENDOR, 1n))).toBe("IsPaused");
    expect(await code(exec.allocate("0x1", buckets({ OPERATING: 1n })))).toBe("IsPaused");
    expect(await code(exec.approve(1))).toBe("IsPaused");
    expect(await code(exec.reject(1))).toBe("ok");
    await exec.unpause();
    expect(await code(exec.pay("0x1", "OPERATING", VENDOR, 1n))).toBe("ok");
    expect(exec.anchors.filter((a) => a.action === "PAUSE" || a.action === "UNPAUSE")).toHaveLength(2);
  });

  it("yield: disabled by default, sweep and redeem when enabled", async () => {
    const off = (await setup()).exec;
    expect(await code(off.sweepToYield("0x1", 1n))).toBe("YieldDisabled");
    expect(await code(off.redeemFromYield("0x1", 1n))).toBe("YieldDisabled");

    const { exec } = await setup({ yieldEnabled: true });
    await exec.sweepToYield("0x2", 600n * U);
    let snap = await exec.snapshot();
    expect(snap).toMatchObject({ yieldDeployed: 600n * U, unallocated: 0n });
    expect(snap.buckets.YIELD).toBe(400n * U);
    await exec.redeemFromYield("0x3", 250n * U);
    snap = await exec.snapshot();
    expect(snap.buckets.YIELD).toBe(650n * U);
    expect(await code(exec.redeemFromYield("0x4", 351n * U))).toBe("InsufficientYield");
    expect(await code(exec.sweepToYield("0x4", 651n * U))).toBe("InsufficientBucket");
    expect(await code(exec.sweepToYield("0x4", 0n))).toBe("ZeroAmount");
    expect(await code(exec.setYieldEnabled("0x5", false))).toBe("InsufficientYield");
    await exec.redeemFromYield("0x6", 350n * U);
    expect(await code(exec.setYieldEnabled("0x7", false))).toBe("ok");
  });

  it("validates caps like the vault", async () => {
    const { exec } = await setup();
    expect(await code(exec.setCaps("0x1", { perTxCap: 100n, dailyCap: 50n, escalateAbove: 10n }))).toBe("InvalidCaps");
    expect(await code(exec.setCaps("0x1", { perTxCap: 100n, dailyCap: 500n, escalateAbove: 200n }))).toBe("InvalidCaps");
    await exec.setCaps("0x1", { perTxCap: 10n * U, dailyCap: 20n * U, escalateAbove: 5n * U });
    expect(await code(exec.pay("0x2", "OPERATING", VENDOR, 11n * U))).toBe("PerTxCapExceeded");
    expect(() => new LocalExecutor({ caps: { perTxCap: 0n, dailyCap: 0n, escalateAbove: 0n } })).toThrow(VaultError);
  });
});

describe("executeProposal", () => {
  const allow: PolicyVerdict = { decision: "allow", reasons: [], spentToday: 0n };
  it("routes executable proposals and skips the rest", async () => {
    const { exec } = await setup({ yieldEnabled: true });
    exec.deposit(100n * U);
    const run = (action: Parameters<typeof proposal>[0], verdict: PolicyVerdict | null = allow) =>
      executeProposal(exec, "0xh", proposal(action, "r", [], 1, verdict));

    expect(await run({ kind: "allocate", amounts: buckets({ OPERATING: 100n * U }) })).toHaveProperty("txHash");
    expect(await run({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 1n, ref: "b" })).toMatchObject({ status: "paid" });
    expect(await run({ kind: "refund", to: VENDOR, amount: 1n, ref: "p" })).toMatchObject({ status: "paid" });
    expect(await run({ kind: "sweep_to_yield", amount: 1n })).toHaveProperty("txHash");
    expect(await run({ kind: "redeem_from_yield", amount: 1n })).toHaveProperty("txHash");
    expect(await run({ kind: "defer", reason: "x" })).toBeNull();
    expect(await run({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 1n, ref: "b" }, { decision: "deny", reasons: ["risk_block"], spentToday: 0n })).toBeNull();
    expect(await run({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 1n, ref: "b" }, { decision: "escalate", reasons: ["below_min_float"], escalation: "offchain", spentToday: 0n })).toBeNull();
    expect(await run({ kind: "payout", bucket: "OPERATING", to: VENDOR, amount: 800n * U, ref: "b" }, { decision: "escalate", reasons: ["above_escalation_threshold"], escalation: "vault", spentToday: 0n })).toMatchObject({ status: "escalated" });
  });
});
