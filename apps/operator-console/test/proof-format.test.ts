import { describe, expect, it } from "vitest";
import { baseUnitsToUsdc, formatDuration, formatUsd, formatUsdc, shortHash } from "../lib/format";
import { anchorStatus, formatProof, verifyRecent } from "../lib/proof-format";
import type { DecisionVerification, OperatorProof } from "../lib/types";

const TX_A = `0x${"a".repeat(64)}`;
const TX_B = `0x${"b".repeat(64)}`;

const proof: OperatorProof = {
  orgs: 3,
  counterparties: 7,
  usdcIn: "12500.5",
  usdcOut: "310",
  decisions: { total: 20, executed: 12, escalated: 4, denied: 2, deferred: 1, failed: 1, blockedByPolicy: 3, blockedOnChain: 1, byModel: { heuristic: 5, "claude-sonnet-5": 15 } },
  latencyMs: { avg: 2100, p50: 1800, p95: 5400 },
  modelCost: { totalUsd: 0.1234, perLlmDecisionUsd: 0.008227, llmDecisions: 15 },
  recentAnchors: [
    { decisionId: "dec_1", txHash: TX_A, outcome: "executed", createdAt: "2026-10-07T09:00:00.000Z", explorerUrl: `https://testnet.arcscan.app/tx/${TX_A}` },
    { decisionId: "dec_2", txHash: TX_B, outcome: "escalated", createdAt: "2026-10-07T08:00:00.000Z" },
  ],
  generatedAt: "2026-10-07T09:30:00.000Z",
  network: "arc-testnet",
  executor: "circle-dcw",
  vault: "0x00000000000000000000000000000000000000f1",
};

const verification = (onChain: DecisionVerification["onChain"], chainValid = true): DecisionVerification => ({
  decisionId: "d",
  orgId: "o",
  chain: { valid: chainValid, checked: 3 },
  hash: "0x1",
  anchorHash: "0x2",
  commitment: "match",
  onChain,
  valid: chainValid,
});

describe("proof formatting", () => {
  it("formats money, durations and costs", () => {
    expect(formatUsdc("12500.5")).toBe("12,500.50");
    expect(formatUsdc("0.000123")).toBe("0.000123");
    expect(formatUsdc("1000000")).toBe("1,000,000.00");
    expect(baseUnitsToUsdc("120000000")).toBe("120");
    expect(baseUnitsToUsdc("1500001")).toBe("1.500001");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1800)).toBe("1.8 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatUsd(0.008227)).toBe("$0.0082");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(shortHash(TX_A)).toBe(`0xaaaaaa…aaaaaa`);
  });

  it("derives one anchored status per decision", () => {
    expect(anchorStatus(null)).toBe("unverified");
    expect(anchorStatus(verification("not_configured"))).toBe("not_configured");
    expect(anchorStatus(verification([{ txHash: TX_A, status: "anchored", actions: ["PAY"] }]))).toBe("anchored");
    expect(anchorStatus(verification([
      { txHash: TX_A, status: "anchored", actions: [] },
      { txHash: TX_B, status: "missing_anchor", actions: [] },
    ]))).toBe("missing_anchor");
    expect(anchorStatus(verification([{ txHash: TX_A, status: "reverted", actions: [] }]))).toBe("reverted");
  });

  it("builds tiles, outcome shares and Arcscan-linked recent rows", () => {
    const view = formatProof(proof, "https://testnet.arcscan.app/", {
      dec_1: verification([{ txHash: TX_A, status: "anchored", actions: ["PAY"] }]),
      dec_2: null,
    });
    expect(view.networkLabel).toBe("Arc testnet");
    expect(view.isSimulation).toBe(false);
    const tiles = Object.fromEntries(view.tiles.map((t) => [t.label, t.value]));
    expect(tiles).toMatchObject({
      Organizations: "3",
      Counterparties: "7",
      "USDC in": "12,500.50 USDC",
      "USDC out": "310.00 USDC",
      Decisions: "20",
      "Median latency": "1.8 s",
      "Model cost per decision": "$0.0082",
    });
    const outcomes = Object.fromEntries(view.outcomes.map((o) => [o.key, `${o.count}/${o.share}`]));
    expect(outcomes).toMatchObject({ executed: "12/60%", escalated: "4/20%", blockedByPolicy: "3/15%", blockedOnChain: "1/5%" });
    expect(view.recent[0]).toMatchObject({ txUrl: `https://testnet.arcscan.app/tx/${TX_A}`, anchor: "anchored", anchorLabel: "Anchored on Arc", chainValid: true });
    expect(view.recent[1]).toMatchObject({ txUrl: `https://testnet.arcscan.app/tx/${TX_B}`, anchor: "unverified", chainValid: null });
    expect(view.models[0]).toEqual({ model: "claude-sonnet-5", count: 15 });
  });

  it("labels simulations and handles an empty log", () => {
    const empty = formatProof({ ...proof, executor: "local-simulation", recentAnchors: [], decisions: { ...proof.decisions, total: 0, executed: 0 } }, "https://x");
    expect(empty.isSimulation).toBe(true);
    expect(empty.recent).toEqual([]);
    expect(empty.outcomes.find((o) => o.key === "executed")?.share).toBe("0%");
  });

  it("verifies recent anchors independently; one failure does not sink the page", async () => {
    const results = await verifyRecent(proof, async (id) => {
      if (id === "dec_2") throw new Error("rpc down");
      return verification([{ txHash: TX_A, status: "anchored", actions: [] }]);
    });
    expect(results.dec_1?.valid).toBe(true);
    expect(results.dec_2).toBeNull();
  });
});
