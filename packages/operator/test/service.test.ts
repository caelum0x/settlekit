import { describe, expect, it } from "vitest";
import type { X402Gateway } from "../src/context.js";
import { ClaudeOperator, HeuristicEngine, OperatorAgent } from "../src/engine.js";
import { ESCALATION_TTL_MS } from "../src/escalation.js";
import { VaultTxError } from "../src/executor.js";
import { createStoreHistory } from "../src/history.js";
import { DuplicateEventError, OperatorServiceError } from "../src/service.js";
import { recordExecutions, recordX402Spends } from "../src/trace.js";
import { POLICY, STRANGER, T0, VENDOR } from "./fixtures.js";
import { REASONING, billDue, harness, revenue, scriptedAnthropic, usdc } from "./harness.js";

const CUSTOMER = "0x00000000000000000000000000000000000000aa";
const ALLOCATED = { OPERATING: usdc(1400), TAX: usdc(500), YIELD: usdc(50), REFUND: usdc(50) };

function claudeAgent(script: Parameters<typeof scriptedAnthropic>[0]) {
  const scripted = scriptedAnthropic(script);
  return { ...scripted, agent: new OperatorAgent({ claude: new ClaudeOperator({ client: scripted.client }) }) };
}

describe("OperatorService escalations", () => {
  it("rejects a vault escalation on-chain and re-anchors the original decision hash", async () => {
    const h = harness({ engine: new HeuristicEngine(), deposit: usdc(2000) });
    await h.vault.allocate(`0x${"a".repeat(64)}`, ALLOCATED);
    const decision = await h.service.handle(billDue("bill_9", VENDOR, usdc(600)));
    const [e] = await h.store.listEscalations("org_1", "pending");
    const rejection = await h.service.reject("org_1", e!.id, "owner", "not this month");
    expect(rejection.outcome).toBe("denied");
    expect(rejection.anchorHash).toBe(decision.anchorHash);
    expect(h.vault.anchors.at(-1)).toEqual({ decisionHash: decision.anchorHash, action: "REJECT" });
    expect((await h.store.getEscalation("org_1", e!.id))?.status).toBe("rejected");
    await expect(h.service.approve("org_1", e!.id, "owner")).rejects.toBeInstanceOf(OperatorServiceError);
  });

  it("executes an off-chain escalation's subject on approval", async () => {
    const { agent } = claudeAgent([
      [{ name: "propose_payout", input: { to: VENDOR, amount_usdc: "40", ...REASONING } }],
      { text: "Asked the owner." },
    ]);
    const h = harness({ engine: agent, deposit: usdc(2000) });
    await h.vault.allocate(`0x${"b".repeat(64)}`, ALLOCATED);
    const record = await h.service.handle(revenue(usdc(1), { id: "evt_x" }));
    expect(record.outcome).toBe("escalated");
    const [e] = await h.store.listEscalations("org_1", "pending");
    expect(e?.reasons[0]).toBe("payout without a matching open bill");
    const approval = await h.service.approve("org_1", e!.id, "owner");
    expect(approval.outcome).toBe("executed");
    expect(recordExecutions(approval)[0]?.result.status).toBe("executed");
    expect(h.vault.anchors.at(-1)).toEqual({ decisionHash: approval.anchorHash, action: "PAY" });
    const history = await createStoreHistory(h.store).list("org_1", VENDOR);
    expect(history.map((x) => [x.direction, x.amount])).toEqual([["out", usdc(40)]]);
  });

  it("expires stale escalations after 72h and releases the vault reservation", async () => {
    const h = harness({ engine: new HeuristicEngine(), deposit: usdc(2000) });
    await h.vault.allocate(`0x${"c".repeat(64)}`, ALLOCATED);
    await h.service.handle(billDue("bill_10", VENDOR, usdc(600)));
    expect(await h.service.expireStale("org_1")).toEqual([]);
    h.clock = new Date(T0.getTime() + ESCALATION_TTL_MS + 1000);
    const [expired] = await h.service.expireStale("org_1");
    expect(expired?.model).toBe("system");
    expect(expired?.outcome).toBe("denied");
    expect(h.vault.escalation(1)?.status).toBe("Expired");
    expect((await h.vault.snapshot()).buckets.OPERATING).toBe(usdc(1400));
  });

  it("records a vault revert as blocked on-chain", async () => {
    const h = harness({ engine: new HeuristicEngine(), deposit: usdc(100) });
    const record = await h.service.handle(billDue("bill_11", STRANGER, usdc(10)));
    expect(record.outcome).toBe("escalated");
    const [e] = await h.store.listEscalations("org_1", "pending");
    const approval = await h.service.approve("org_1", e!.id, "owner");
    expect(approval.outcome).toBe("failed");
    expect(recordExecutions(approval)[0]?.result).toEqual({ status: "blocked_on_chain", error: "NotAllowlisted" });
    expect((await h.store.getEscalation("org_1", e!.id))?.status).toBe("pending");
  });
});

describe("exactly-once handling", () => {
  it("claims each event once and releases the claim when deciding fails", async () => {
    let fail = true;
    const flaky = {
      name: "flaky",
      decide: async (...args: Parameters<HeuristicEngine["decide"]>) => {
        if (fail) throw new Error("engine down");
        return new HeuristicEngine().decide(...args);
      },
    };
    const h = harness({ engine: flaky, deposit: usdc(100) });
    await expect(h.service.handle(revenue(usdc(100)))).rejects.toThrow(/engine down/);
    fail = false;
    const record = await h.service.handle(revenue(usdc(100)));
    expect(record.outcome).toBe("executed");
    await expect(h.service.handle(revenue(usdc(100)))).rejects.toBeInstanceOf(DuplicateEventError);
    expect(h.vault.anchors.filter((a) => a.action === "ALLOCATE")).toHaveLength(1);
  });

  it("resolves an escalation once even when approvals race", async () => {
    const h = harness({ engine: new HeuristicEngine(), deposit: usdc(2000) });
    await h.vault.allocate(`0x${"7".repeat(64)}`, ALLOCATED);
    await h.service.handle(billDue("bill_race", VENDOR, usdc(600)));
    const [e] = await h.store.listEscalations("org_1", "pending");
    const results = await Promise.allSettled([h.service.approve("org_1", e!.id, "a"), h.service.approve("org_1", e!.id, "b")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(h.vault.anchors.filter((a) => a.action === "APPROVE")).toHaveLength(1);
  });

  it("keeps the txHash of a broadcast transaction whose receipt is unavailable", async () => {
    const h = harness({ engine: new HeuristicEngine(), deposit: usdc(100) });
    const original = h.vault.allocate.bind(h.vault);
    h.vault.allocate = async () => {
      throw new VaultTxError("0xbroadcast", "unconfirmed", "rpc timeout");
    };
    const record = await h.service.handle(revenue(usdc(100)));
    expect(record.outcome).toBe("failed");
    expect(record.txHash).toBe("0xbroadcast");
    expect(recordExecutions(record)[0]?.result).toMatchObject({ status: "failed", txHash: "0xbroadcast" });
    h.vault.allocate = original;
  });
});

describe("Claude action tools", () => {
  const gateway = (price: bigint): X402Gateway & { bought: string[] } => {
    const bought: string[] = [];
    return {
      bought,
      quote: async (url) => ({ url, price, payTo: VENDOR, network: "arc-testnet", resource: url }),
      buy: async (url) => {
        bought.push(url);
        return { quote: { url, price, payTo: VENDOR, network: "arc-testnet", resource: url }, txHash: "0xx402", status: 200, body: "credit score: 710" };
      },
      purchasesToday: async () => 0,
    };
  };

  it("buys an x402 service when policy allows and records the spend", async () => {
    const g = gateway(usdc(1) / 100n);
    const { agent, requests } = claudeAgent([
      [{ name: "quote_x402_service", input: { url: "https://svc.example/score" } }],
      [{ name: "buy_x402_service", input: { url: "https://svc.example/score", max_price_usdc: "0.05", ...REASONING } }],
      [{ name: "propose_allocation", input: { ...REASONING } }],
    ]);
    const h = harness({ engine: agent, deposit: usdc(100), x402: g });
    await h.vault.allocate(`0x${"d".repeat(64)}`, { OPERATING: usdc(50), TAX: 0n, YIELD: 0n, REFUND: 0n });
    const record = await h.service.handle(revenue(usdc(50)));
    expect(g.bought).toEqual(["https://svc.example/score"]);
    const reply = JSON.parse(requests[2]!.messages.at(-1).content[0].content);
    expect(reply).toMatchObject({ status: "purchased", untrusted_service_response: "credit score: 710", price_usdc: "0.01" });
    expect(recordX402Spends(record)).toEqual([{ payTo: VENDOR, amount: 10_000n, txHash: "0xx402" }]);
  });

  it("refunds only the customer and payment from the triggering request", async () => {
    const { agent, requests } = claudeAgent([
      [{ name: "propose_refund", input: { to: CUSTOMER, amount_usdc: "30", payment_ref: "0xpay1", ...REASONING } }],
      [{ name: "propose_refund", input: { to: CUSTOMER, amount_usdc: "20", payment_ref: "0xpay1", ...REASONING } }],
    ]);
    const policy = { ...POLICY, allowlist: [VENDOR, CUSTOMER] };
    const h = harness({ engine: agent, deposit: usdc(2000), allowlist: [VENDOR, CUSTOMER], policy });
    await h.vault.allocate(`0x${"e".repeat(64)}`, ALLOCATED);
    const event = { type: "refund.requested", id: "evt_ref", orgId: "org_1", at: T0.toISOString(), customer: CUSTOMER, amount: usdc(20), paymentRef: "0xpay1", reason: "duplicate charge" } as const;
    const record = await h.service.handle(event);
    expect(JSON.parse(requests[1]!.messages.at(-1).content[0].content)).toMatchObject({ status: "denied", reasons: ["exceeds_requested_amount"] });
    expect(record.outcome).toBe("executed");
    expect((await h.vault.snapshot()).buckets.REFUND).toBe(usdc(30));
  });

  it("sweeps toward the yield target and refuses beyond it", async () => {
    const { agent, requests } = claudeAgent([
      [{ name: "sweep_to_yield", input: { amount_usdc: "40", ...REASONING } }],
      [{ name: "sweep_to_yield", input: { amount_usdc: "20", ...REASONING } }],
    ]);
    const h = harness({ engine: agent, deposit: usdc(2000), policy: { ...POLICY, yieldTarget: usdc(25) } });
    await h.vault.allocate(`0x${"f".repeat(64)}`, ALLOCATED);
    const tick = { type: "tick", id: "tick_1", orgId: "org_1", at: T0.toISOString() } as const;
    const record = await h.service.handle(tick);
    expect(JSON.parse(requests[1]!.messages.at(-1).content[0].content)).toMatchObject({ status: "denied", reasons: ["above_yield_target"] });
    expect(record.outcome).toBe("executed");
    expect((await h.vault.snapshot()).yieldDeployed).toBe(usdc(20));
  });

  it("escalates disputes and caps proposals per event", async () => {
    const many = Array.from({ length: 8 }, () => ({ name: "escalate", input: { reason: "check", ...REASONING } }));
    const { agent, requests } = claudeAgent([many]);
    const h = harness({ engine: agent, deposit: usdc(10) });
    const dispute = { type: "dispute.opened", id: "d1", orgId: "org_1", at: T0.toISOString(), disputeId: "dp_1", customer: CUSTOMER, amount: usdc(5), paymentRef: "0xpay1" } as const;
    const record = await h.service.handle(dispute);
    expect(requests[0]!.model).toBe("claude-opus-5-5");
    expect(record.outcome).toBe("escalated");
    expect(await h.store.listEscalations("org_1", "pending")).toHaveLength(6);
  });
});
