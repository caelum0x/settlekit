import { describe, expect, it, vi } from "vitest";
import { maxUint256 } from "viem";
import { PERMIT2_ADDRESS } from "../src/addresses.js";
import { SubscriptionChargeEngine, type ChargeEngineHooks } from "../src/charge-engine.js";
import { Permit2Billing } from "../src/permit2-allowance.js";
import {
  ChargeDeclinedError,
  DeferChargeError,
  IndeterminateChargeError,
  type ChargeProvider,
  type CollectContext,
  type CollectOutcome,
  type InvoiceStatus,
} from "../src/provider.js";
import type { OnchainSubscription } from "../src/types.js";
import { BASE_USDC, Clock, MERCHANT, MONTH, T0, baseChain, billingDeps, operatorAccount, payerAccount, subscriptionFixture, syncChain } from "./helpers.js";

type Script = (sub: OnchainSubscription, ctx: CollectContext) => Promise<CollectOutcome>;

class ScriptedProvider implements ChargeProvider {
  readonly method = "permit2" as const;
  calls = 0;
  invoice: InvoiceStatus = "open";
  constructor(private script: Script) {}
  set(script: Script) {
    this.script = script;
  }
  async collect(sub: OnchainSubscription, ctx: CollectContext) {
    this.calls += 1;
    return this.script(sub, ctx);
  }
  async invoiceStatus() {
    return this.invoice;
  }
}

const GRANT = { kind: "renewal_invoice" as const, email: "buyer@example.com" };

function engineWith(provider: ChargeProvider, clock: Clock, hooks: ChargeEngineHooks = {}, method: OnchainSubscription["method"] = "permit2") {
  const deps = billingDeps(clock);
  let n = 0;
  const engine = new SubscriptionChargeEngine({
    store: deps.store,
    providers: { [method]: provider },
    dunning: deps.dunning,
    hooks,
    now: clock.now,
    newId: () => `och_${++n}`,
    leaseMs: 60_000,
  });
  return { ...deps, engine };
}

describe("SubscriptionChargeEngine", () => {
  it("charges period 0 on activation, then nothing until the next period starts", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => ({ status: "succeeded", txHash: "0xaaa" }));
    const onCollected = vi.fn(async () => undefined);
    const { engine, store } = engineWith(provider, clock, { onCollected });
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));

    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
    expect(await engine.chargeSubscription("osub_1")).toBe("not_due");
    expect(provider.calls).toBe(1);
    expect((await store.getSubscription("osub_1"))?.paidThrough).toBe(0);
    const [, charge, period] = onCollected.mock.calls[0] as unknown as [OnchainSubscription, { txHash: string }, { end: Date }];
    expect(charge.txHash).toBe("0xaaa");
    expect(period.end.toISOString()).toBe(new Date(T0.getTime() + MONTH * 1000).toISOString());

    clock.advanceSeconds(MONTH);
    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
    expect((await store.listCharges("osub_1")).map((c) => [c.periodIndex, c.status])).toEqual([[0, "succeeded"], [1, "succeeded"]]);
  });

  it("never pulls the same period twice under concurrency", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { status: "succeeded", txHash: "0xbbb" };
    });
    const { engine, store } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    const outcomes = await Promise.all(Array.from({ length: 25 }, () => engine.chargeSubscription("osub_1")));
    expect(provider.calls).toBe(1);
    expect(outcomes.filter((o) => o === "succeeded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "in_flight")).toHaveLength(24);
    const summary = await engine.runDue();
    expect(summary.outcomes.osub_1).toBe("not_due");
    expect(provider.calls).toBe(1);
  });

  it("walks dunning on declines, then suspends and recovers on a later success", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => {
      throw new ChargeDeclinedError("insufficient token balance");
    });
    const onPastDue = vi.fn(async () => undefined);
    const onSuspended = vi.fn(async () => undefined);
    const { engine, store, dunning } = engineWith(provider, clock, { onPastDue, onSuspended });
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));

    expect(await engine.chargeSubscription("osub_1")).toBe("failed");
    expect((await store.getSubscription("osub_1"))?.status).toBe("past_due");
    expect(onPastDue).toHaveBeenCalledTimes(1);
    // Retries wait for the dunning schedule (+1d, +3d, +7d).
    expect(await engine.chargeSubscription("osub_1")).toBe("waiting_for_retry");
    clock.advanceSeconds(86_400);
    expect(await engine.chargeSubscription("osub_1")).toBe("failed");
    clock.advanceSeconds(2 * 86_400);
    expect(await engine.chargeSubscription("osub_1")).toBe("failed");
    clock.advanceSeconds(4 * 86_400);
    expect(await engine.chargeSubscription("osub_1")).toBe("suspended");
    expect(onSuspended).toHaveBeenCalledTimes(1);
    const suspended = await store.getSubscription("osub_1");
    expect(suspended).toMatchObject({ status: "suspended", lastChargeError: "insufficient token balance" });
    expect((await dunning.get("sub_1"))?.status).toBe("exhausted");
    expect((await store.getCharge("osub_1", 0))?.attempt).toBe(4);
    // Suspended subscriptions are no longer billed.
    expect(await engine.chargeSubscription("osub_1")).toBe("not_due");
  });

  it("recovers dunning when a retry succeeds", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => {
      throw new ChargeDeclinedError("allowance revoked");
    });
    const { engine, store, dunning } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    await engine.chargeSubscription("osub_1");
    provider.set(async () => ({ status: "succeeded", txHash: "0xccc" }));
    clock.advanceSeconds(86_400);
    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
    expect((await store.getSubscription("osub_1"))).toMatchObject({ status: "active", paidThrough: 0 });
    expect((await store.getSubscription("osub_1"))?.lastChargeError).toBeUndefined();
    expect((await dunning.get("sub_1"))?.status).toBe("recovered");
  });

  it("leaves indeterminate charges pending and resumes them with their steps after the lease", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async (_sub, ctx) => {
      await ctx.recordStep("transfer", "0xddd");
      throw new IndeterminateChargeError("receipt lost");
    });
    const { engine, store } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    expect(await engine.chargeSubscription("osub_1")).toBe("indeterminate");
    expect((await store.getCharge("osub_1", 0))).toMatchObject({ status: "pending", steps: [{ step: "transfer", txHash: "0xddd" }] });
    expect(await engine.chargeSubscription("osub_1")).toBe("in_flight");
    let seenSteps: string[] = [];
    provider.set(async (_sub, ctx) => {
      seenSteps = ctx.charge.steps.map((s) => s.txHash);
      return { status: "succeeded", txHash: "0xddd" };
    });
    clock.advanceSeconds(61);
    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
    expect(seenSteps).toEqual(["0xddd"]);
  });

  it("releases deferred charges without dunning", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => {
      throw new DeferChargeError("chain clock behind");
    });
    const { engine, store, dunning } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    expect(await engine.chargeSubscription("osub_1")).toBe("deferred");
    expect(await dunning.get("sub_1")).toBeUndefined();
    provider.set(async () => ({ status: "succeeded" }));
    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
  });

  it("polls renewal invoices until paid, and dunning-fails expired ones", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => ({ status: "awaiting_payment", invoiceRef: "cs_1" }));
    const onInvoiced = vi.fn(async () => undefined);
    const { engine, store } = engineWith(provider, clock, { onInvoiced });
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    expect(await engine.chargeSubscription("osub_1")).toBe("awaiting_payment");
    expect(onInvoiced).toHaveBeenCalledTimes(1);
    expect(await engine.chargeSubscription("osub_1")).toBe("awaiting_payment");
    expect(provider.calls).toBe(1);
    provider.invoice = "paid";
    expect(await engine.chargeSubscription("osub_1")).toBe("succeeded");
    expect((await store.getSubscription("osub_1"))?.paidThrough).toBe(0);

    clock.advanceSeconds(MONTH);
    provider.invoice = "open";
    expect(await engine.chargeSubscription("osub_1")).toBe("awaiting_payment");
    provider.invoice = "expired";
    expect(await engine.chargeSubscription("osub_1")).toBe("failed");
    expect((await store.getCharge("osub_1", 1))?.failureReason).toMatch(/expired/);
  });

  it("stops at period end when canceled, and declines once the grant's periods are used up", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async () => ({ status: "succeeded" }));
    const { engine, store } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never, paidThrough: 0, cancelAtPeriodEnd: true }));
    clock.advanceSeconds(MONTH);
    expect(await engine.chargeSubscription("osub_1")).toBe("canceled");
    expect((await store.getSubscription("osub_1"))?.status).toBe("canceled");

    await store.saveSubscription(subscriptionFixture({ id: "osub_2", subscriptionId: "sub_2", grant: GRANT as never, periodsCovered: 1, paidThrough: 0 }));
    expect(await engine.chargeSubscription("osub_2")).toBe("failed");
    expect((await store.getCharge("osub_2", 1))?.failureReason).toMatch(/re-authorize/);
    expect(provider.calls).toBe(0);
  });

  it("reports runDue totals and survives a crashing provider", async () => {
    const clock = new Clock();
    const provider = new ScriptedProvider(async (sub) => {
      if (sub.id === "osub_bad") throw new Error("boom");
      return { status: "succeeded" };
    });
    const { engine, store } = engineWith(provider, clock);
    await store.saveSubscription(subscriptionFixture({ grant: GRANT as never }));
    await store.saveSubscription(subscriptionFixture({ id: "osub_bad", subscriptionId: "sub_bad", grant: GRANT as never }));
    await store.saveSubscription(subscriptionFixture({ id: "osub_pending", status: "pending_grant", grant: undefined }));
    const summary = await engine.runDue();
    expect(summary).toMatchObject({ processed: 2, succeeded: 1, failed: 1 });
    expect(summary.outcomes).toEqual({ osub_1: "succeeded", osub_bad: "failed" });
    expect((await store.getCharge("osub_bad", 0))?.failureReason).toMatch(/boom/);
  });
});

describe("SubscriptionChargeEngine + Permit2 on a simulated chain", () => {
  it("bills monthly through Permit2 with one transferFrom per period", async () => {
    const clock = new Clock();
    const chain = baseChain(clock);
    const operator = chain.operator(operatorAccount.address);
    const permit2 = new Permit2Billing([operator]);
    chain.mint(BASE_USDC, payerAccount.address, 50_000_000n);
    chain.setErc20Allowance(BASE_USDC, payerAccount.address, PERMIT2_ADDRESS, maxUint256);
    const price = 9_990_000n;
    const intent = await permit2.createIntent(8453, { owner: payerAccount.address, token: BASE_USDC, amountPerPeriod: price, periods: 3, anchor: T0, periodSeconds: MONTH, now: T0 });
    const signature = await payerAccount.signTypedData(intent.typedData as never);
    const grant = await permit2.acceptGrant({
      kind: "permit2", chainId: 8453, owner: payerAccount.address, token: BASE_USDC, spender: operator.address,
      amount: intent.permit.details.amount.toString(), expiration: intent.permit.details.expiration, nonce: 0,
      sigDeadline: intent.permit.sigDeadline.toString(), signature,
    }, T0);
    const { engine, store } = engineWith(permit2, clock);
    await store.saveSubscription(subscriptionFixture({ grant, periodsCovered: 3 }));

    for (let period = 0; period < 3; period++) {
      syncChain(chain, clock);
      await Promise.all([engine.runDue(), engine.runDue(), engine.runDue()]);
      clock.advanceSeconds(MONTH);
    }
    expect(chain.txs.filter((t) => t.functionName === "transferFrom")).toHaveLength(3);
    expect(chain.balanceOf(BASE_USDC, MERCHANT)).toBe(3n * price);
    syncChain(chain, clock);
    const fourth = await engine.chargeSubscription("osub_1");
    expect(fourth).toBe("failed");
    expect(chain.txs.filter((t) => t.functionName === "transferFrom")).toHaveLength(3);
  });
});
