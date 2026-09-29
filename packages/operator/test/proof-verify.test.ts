import type { ArcTransactionReceipt, Hex } from "@settlekit/arc";
import { stringToHex } from "viem";
import { describe, expect, it } from "vitest";
import { HeuristicEngine } from "../src/engine.js";
import { PolicyAdmin, PolicyDriftError, PolicyValidationError, parsePolicy, policyView } from "../src/policy-admin.js";
import { computeProof } from "../src/proof.js";
import { InMemoryOperatorStore } from "../src/store.js";
import { DECISION_ANCHORED_TOPIC, findDecision, verifyDecision, type ReceiptSource } from "../src/verify.js";
import { POLICY, STRANGER, VENDOR } from "./fixtures.js";
import { billDue, harness, revenue, usdc } from "./harness.js";

const VAULT = "0x00000000000000000000000000000000000000f1";

/** Receipts that carry DecisionAnchored for exactly the anchors we register. */
function receiptsFor(anchors: Map<string, string>): ReceiptSource {
  return {
    async getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null> {
      const anchor = anchors.get(txHash);
      if (!anchor) return null;
      return {
        transactionHash: txHash,
        blockNumber: 1n,
        status: "success",
        from: VAULT as Hex,
        to: VAULT as Hex,
        logs: [{ address: VAULT as Hex, topics: [DECISION_ANCHORED_TOPIC, anchor as Hex, stringToHex("PAY", { size: 32 })], data: "0x", logIndex: 0 }],
      };
    },
  };
}

async function activity() {
  const h = harness({ engine: new HeuristicEngine(), deposit: usdc(2000) });
  const sale = await h.service.handle(revenue(usdc(2000)));
  await h.service.handle(billDue("b1", VENDOR, usdc(100)));
  await h.service.handle(billDue("b2", STRANGER, usdc(10)));
  const escalated = await h.service.handle(billDue("b3", VENDOR, usdc(600)));
  const [e] = await h.store.listEscalations("org_1", "pending").then((l) => l.filter((x) => x.vaultEscalationId !== undefined));
  const approval = await h.service.approve("org_1", e!.id, "owner");
  return { h, sale, escalated, approval };
}

describe("computeProof", () => {
  it("aggregates flows, outcomes, latency and excludes the demo org", async () => {
    const { h } = await activity();
    await h.service.handle({ ...revenue(usdc(5)), id: "demo_sale", orgId: "demo" });
    expect(await h.store.listOrgIds()).toContain("demo");

    const proof = await computeProof(h.store, { explorerUrl: "https://testnet.arcscan.app/" });
    expect(proof.orgs).toBe(1);
    expect(proof.decisions).toMatchObject({ total: 5, executed: 3, escalated: 2 });
    expect(proof.decisions.byModel).toEqual({ "heuristic-v1": 4, owner: 1 });
    expect(proof.counterparties).toBe(2);
    expect(proof.recentAnchors[0]?.explorerUrl).toMatch(/^https:\/\/testnet\.arcscan\.app\/tx\/0x/);
    expect(Number(proof.usdcOut)).toBe(700);
    expect(Number(proof.usdcIn)).toBe(2000);
  });
});

describe("verifyDecision", () => {
  it("verifies chain, commitment and the on-chain anchor, including owner re-anchors", async () => {
    const { h, escalated, approval } = await activity();
    const anchors = new Map<string, string>();
    for (const r of await h.store.listDecisions("org_1")) for (const tx of r.txHashes ?? []) anchors.set(tx, r.anchorHash!);
    const receipts = receiptsFor(anchors);

    const ok = await verifyDecision(h.store, escalated, { receipts, vault: VAULT, explorerUrl: "https://x.test" });
    expect(ok).toMatchObject({ valid: true, commitment: "match", chain: { valid: true } });
    expect(ok.onChain).toEqual([{ txHash: escalated.txHash, status: "anchored", actions: ["PAY"], explorerUrl: `https://x.test/tx/${escalated.txHash}` }]);
    const owner = await verifyDecision(h.store, approval, { receipts, vault: VAULT });
    expect(owner.commitment).toBe("owner_reanchor");
    expect(owner.valid).toBe(true);
    expect(await findDecision(h.store, approval.id)).toEqual(approval);
    expect(await findDecision(h.store, "missing")).toBeNull();
  });

  it("flags missing anchors, unknown transactions and tampered records", async () => {
    const { h, sale } = await activity();
    const wrong = await verifyDecision(h.store, sale, { receipts: receiptsFor(new Map([[sale.txHash!, `0x${"0".repeat(64)}`]])), vault: VAULT });
    expect(wrong.valid).toBe(false);
    expect((wrong.onChain as { status: string }[])[0]?.status).toBe("missing_anchor");
    const unknown = await verifyDecision(h.store, sale, { receipts: receiptsFor(new Map()) });
    expect((unknown.onChain as { status: string }[])[0]?.status).toBe("not_found");
    expect((await verifyDecision(h.store, sale)).onChain).toBe("not_configured");

    const tampered = new InMemoryOperatorStore();
    const records = await h.store.listDecisions("org_1");
    const forged = { ...records[0]!, rationale: "edited later" };
    await tampered.appendDecision(forged);
    const result = await verifyDecision(tampered, forged);
    expect(result.chain.valid).toBe(false);
    expect(result.commitment).toBe("mismatch");
    expect(result.valid).toBe(false);
  });
});

describe("PolicyAdmin", () => {
  const body = { ...policyView(POLICY), allowlist: [VENDOR] };

  it("parses USDC policy bodies and reports every issue", () => {
    expect(parsePolicy(body)).toEqual(POLICY);
    expect(() => parsePolicy({ ...body, perTxCap: "-5", allowlist: ["nope"], split: { OPERATING: 1 } })).toThrow(PolicyValidationError);
    expect(() => parsePolicy(null)).toThrow(/object/);
  });

  it("refuses drift from on-chain caps and allowlist, and falls back to vault caps", async () => {
    const h = harness({ engine: new HeuristicEngine() });
    const admin = new PolicyAdmin({ store: h.store, defaults: { ...POLICY, perTxCap: 1n, dailyCap: 1n, escalateAbove: 1n }, vault: h.vault });
    expect((await admin.get("org_1")).perTxCap).toBe(POLICY.perTxCap);
    await expect(admin.put("org_1", { ...body, perTxCap: "999" })).rejects.toBeInstanceOf(PolicyDriftError);
    await expect(admin.put("org_1", { ...body, allowlist: [VENDOR, STRANGER] })).rejects.toThrow(/not allowlisted on-chain/);
    const saved = await admin.put("org_1", { ...body, minFloat: "25" });
    expect(saved.minFloat).toBe(usdc(25));
    expect(await admin.get("org_1")).toEqual(saved);
    expect(await new PolicyAdmin({ store: new InMemoryOperatorStore(), defaults: POLICY }).drift(POLICY)).toEqual([]);
  });
});

