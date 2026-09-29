import { describe, expect, it } from "vitest";
import { money, type CheckoutSession, type Payment } from "@settlekit/common";
import { createOperatorRuntime, LocalExecutor, type OperatorRuntime } from "@settlekit/operator";
import type { JobContext } from "../src/jobs/types.js";
import { createOperatorTickJob, operatorTickJob } from "../src/jobs/operator-tick-job.js";

const U = 1_000_000n;
const ORG = "org_ops";
const VAULT = "0x00000000000000000000000000000000000000f1";
const VENDOR = "0x00000000000000000000000000000000007e2d02";
const PAYER = "0x00000000000000000000000000000000000000aa";
const KEY = `0x${"1".repeat(64)}`;
const T0 = new Date("2026-10-04T12:00:00.000Z");

function payment(over: Partial<Payment>): Payment {
  return {
    id: "pay_1",
    organizationId: ORG,
    checkoutSessionId: "cs_1",
    customerId: "cus_1",
    amount: money("1000"),
    network: "arc",
    txHash: "0xtx1",
    confirmations: 3,
    status: "confirmed",
    createdAt: T0.toISOString(),
    confirmedAt: T0.toISOString(),
    ...over,
  } as Payment;
}

const session = (payTo: string) => ({ id: "cs_1", organizationId: ORG, payToAddress: payTo, network: "arc" }) as unknown as CheckoutSession;

interface Harness {
  readonly ctx: JobContext;
  readonly runtime: OperatorRuntime;
  readonly vault: LocalExecutor;
  readonly logs: string[];
  setNow(d: Date): void;
}

function harness(payments: Payment[], payTo = VAULT, arcFails = false): Harness {
  let now = T0;
  const clock = () => now;
  const vault = new LocalExecutor({ caps: { perTxCap: 1000n * U, dailyCap: 1500n * U, escalateAbove: 500n * U }, allowlist: [VENDOR], now: clock });
  vault.deposit(1000n * U);
  const runtime = createOperatorRuntime(
    { OPERATOR_VAULT_ADDRESS: VAULT, OPERATOR_PRIVATE_KEY: KEY, OPERATOR_ORG_ID: ORG, OPERATOR_ALLOWLIST: VENDOR },
    "unused",
    { executor: vault, owner: vault, now: clock },
  );
  const logs: string[] = [];
  const ctx = {
    stores: {
      confirmedPayments: async () => payments,
      getCheckoutSession: async (id: string) => (id === "cs_1" ? session(payTo) : undefined),
    },
    arc: {
      verifyUsdcTransfer: async () => {
        if (arcFails) throw new Error("rpc down");
        return { confirmed: true, from: PAYER, amount: money("1000"), confirmations: 3 };
      },
    },
    logger: {
      info: (m: string) => logs.push(`info ${m}`),
      warn: (m: string) => logs.push(`warn ${m}`),
      error: (m: string) => logs.push(`error ${m}`),
      debug: () => undefined,
    },
    now: clock,
  } as unknown as JobContext;
  return { ctx, runtime, vault, logs, setNow: (d) => { now = d; } };
}

describe("operator tick job", () => {
  it("turns confirmed vault payments into one revenue decision each, plus a daily tick", async () => {
    const h = harness([
      payment({}),
      payment({ id: "pay_other_org", organizationId: "org_x" }),
      payment({ id: "pay_base", network: "base" }),
      payment({ id: "pay_unseen", txHash: undefined }),
    ]);
    const job = createOperatorTickJob(() => h.runtime);
    expect(await job.run(h.ctx)).toEqual({ processed: 2, failed: 0 });
    const decisions = await h.runtime.store.listDecisions(ORG);
    expect(decisions.map((d) => [d.eventRef, d.outcome])).toEqual([
      ["payment:pay_1", "executed"],
      ["tick:2026-10-04", "deferred"],
    ]);
    expect((await h.vault.snapshot()).buckets.TAX).toBe(250n * U);
    const history = decisions[0]!.toolCalls[0]!.input as { payer: string; amount: bigint };
    expect(history).toMatchObject({ payer: PAYER, amount: 1000n * U });

    expect(await job.run(h.ctx)).toEqual({ processed: 0, failed: 0 });
    h.setNow(new Date(T0.getTime() + 86_400_000));
    expect(await job.run(h.ctx)).toEqual({ processed: 1, failed: 0 });
  });

  it("ignores payments that were not paid into the vault", async () => {
    const h = harness([payment({})], "0x00000000000000000000000000000000000000c0");
    await createOperatorTickJob(() => h.runtime).run(h.ctx);
    expect((await h.runtime.store.listDecisions(ORG)).map((d) => d.eventRef)).toEqual(["tick:2026-10-04"]);
  });

  it("falls back to the customer reference when the payer cannot be read", async () => {
    const h = harness([payment({})], VAULT, true);
    await createOperatorTickJob(() => h.runtime).run(h.ctx);
    const first = (await h.runtime.store.listDecisions(ORG))[0]!;
    expect((first.toolCalls[0]!.input as { payer: string }).payer).toBe("customer:cus_1");
    expect(h.logs.some((l) => l.startsWith("warn operator: could not read payer"))).toBe(true);
  });

  it("raises due bills and expires stale escalations", async () => {
    const h = harness([payment({})]);
    const job = createOperatorTickJob(() => h.runtime);
    await job.run(h.ctx);
    const later = new Date(T0.getTime() + 20 * 86_400_000).toISOString();
    await h.runtime.intake.manual(ORG, { payee: VENDOR, amountUsdc: "100", dueAt: later, description: "Hosting" });
    await h.runtime.intake.manual(ORG, { payee: VENDOR, amountUsdc: "510", dueAt: T0.toISOString(), description: "Annual" });
    expect(await h.runtime.store.listEscalations(ORG, "pending")).toHaveLength(1);

    h.setNow(new Date(Date.parse(later) - 86_400_000));
    const result = await job.run(h.ctx);
    expect(result.failed).toBe(0);
    const refs = (await h.runtime.store.listDecisions(ORG)).map((d) => d.eventRef);
    expect(refs.filter((r) => r.startsWith("bill_due:"))).toHaveLength(2);
    expect(refs.filter((r) => r.startsWith("escalation:"))).toHaveLength(1);
    expect(await h.runtime.store.listEscalations(ORG, "expired")).toHaveLength(1);
    expect(h.vault.escalation(1)?.status).toBe("Expired");
    expect(await h.runtime.store.listBills(ORG, "paid")).toHaveLength(1);
    expect(await h.runtime.store.listBills(ORG, "rejected")).toHaveLength(1);
  });

  it("counts failing events without stopping the tick", async () => {
    const h = harness([payment({})]);
    const service = new Proxy(h.runtime.service, {
      get(target, prop) {
        if (prop === "handle") return async () => { throw new Error("vault offline"); };
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const broken = { ...h.runtime, service } as OperatorRuntime;
    expect(await createOperatorTickJob(() => broken).run(h.ctx)).toEqual({ processed: 0, failed: 2 });
    expect(h.logs.filter((l) => l === "error operator event failed")).toHaveLength(2);
  });

  it("is a no-op unless the operator is enabled", async () => {
    const saved = { vault: process.env.OPERATOR_VAULT_ADDRESS, sim: process.env.OPERATOR_SIMULATION };
    delete process.env.OPERATOR_VAULT_ADDRESS;
    delete process.env.OPERATOR_SIMULATION;
    try {
      expect(await operatorTickJob.run(harness([]).ctx)).toEqual({ processed: 0, failed: 0 });
      expect(await createOperatorTickJob(() => null).run(harness([]).ctx)).toEqual({ processed: 0, failed: 0 });
    } finally {
      if (saved.vault !== undefined) process.env.OPERATOR_VAULT_ADDRESS = saved.vault;
      if (saved.sim !== undefined) process.env.OPERATOR_SIMULATION = saved.sim;
    }
  });
});
