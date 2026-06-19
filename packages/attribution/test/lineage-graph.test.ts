import { describe, expect, it } from "vitest";
import {
  LineageGraph,
  computeAttributionShares,
  validateLineageEdge,
} from "../src/lineage-graph.js";

const sum = (shares: readonly { share: number }[]): number =>
  shares.reduce((s, x) => s + x.share, 0);
const shareOf = (shares: readonly { nodeId: string; share: number }[], id: string): number =>
  shares.find((s) => s.nodeId === id)?.share ?? 0;

describe("validateLineageEdge", () => {
  it("rejects self-edges", () => {
    const r = validateLineageEdge({ child: "a", parent: "a", weight: 0.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects weights outside (0, 1]", () => {
    expect(validateLineageEdge({ child: "a", parent: "b", weight: 0 }).ok).toBe(false);
    expect(validateLineageEdge({ child: "a", parent: "b", weight: -0.1 }).ok).toBe(false);
    expect(validateLineageEdge({ child: "a", parent: "b", weight: 1.5 }).ok).toBe(false);
    expect(validateLineageEdge({ child: "a", parent: "b", weight: 1 }).ok).toBe(true);
  });

  it("addEdge throws on an invalid weight", () => {
    expect(() => new LineageGraph().addEdge({ child: "a", parent: "b", weight: 2 })).toThrow();
  });
});

describe("computeAttributionShares", () => {
  it("attributes everything to a root with no ancestors", () => {
    const shares = computeAttributionShares(new LineageGraph(), "leaf");
    expect(shares).toEqual([{ nodeId: "leaf", share: 1, depth: 0 }]);
  });

  it("routes the configured fraction to a direct ancestor", () => {
    const g = new LineageGraph([{ child: "answer", parent: "src", weight: 0.4 }]);
    const shares = computeAttributionShares(g, "answer");
    expect(shareOf(shares, "answer")).toBeCloseTo(0.6, 9);
    expect(shareOf(shares, "src")).toBeCloseTo(0.4, 9);
    expect(sum(shares)).toBeCloseTo(1, 9);
  });

  it("recurses through a multi-hop lineage and conserves the whole", () => {
    // answer -0.5-> remix -0.5-> original
    const g = new LineageGraph([
      { child: "answer", parent: "remix", weight: 0.5 },
      { child: "remix", parent: "original", weight: 0.5 },
    ]);
    const shares = computeAttributionShares(g, "answer");
    expect(shareOf(shares, "answer")).toBeCloseTo(0.5, 9);
    expect(shareOf(shares, "remix")).toBeCloseTo(0.25, 9);
    expect(shareOf(shares, "original")).toBeCloseTo(0.25, 9);
    expect(sum(shares)).toBeCloseTo(1, 9);
  });

  it("accumulates a diamond ancestor from both paths and records shallowest depth", () => {
    // answer derives from b and c (0.5 each); both derive fully from shared 'a'
    const g = new LineageGraph([
      { child: "answer", parent: "b", weight: 0.5 },
      { child: "answer", parent: "c", weight: 0.5 },
      { child: "b", parent: "a", weight: 1 },
      { child: "c", parent: "a", weight: 1 },
    ]);
    const shares = computeAttributionShares(g, "answer");
    // answer keeps nothing (routes 100%), b and c keep nothing (route 100% to a)
    expect(shareOf(shares, "a")).toBeCloseTo(1, 9);
    expect(shares.find((s) => s.nodeId === "a")?.depth).toBe(2);
    expect(sum(shares)).toBeCloseTo(1, 9);
  });

  it("does not loop forever on a cycle", () => {
    const g = new LineageGraph([
      { child: "a", parent: "b", weight: 0.5 },
      { child: "b", parent: "a", weight: 0.5 },
    ]);
    const shares = computeAttributionShares(g, "a");
    expect(sum(shares)).toBeGreaterThan(0);
    expect(shares.length).toBeGreaterThan(0);
  });
});

describe("LineageGraph queries", () => {
  const g = new LineageGraph([
    { child: "answer", parent: "remix", weight: 0.5 },
    { child: "remix", parent: "original", weight: 0.5 },
  ]);

  it("walks transitive ancestors", () => {
    expect([...g.ancestors("answer")].sort()).toEqual(["original", "remix"]);
    expect(g.ancestors("original")).toEqual([]);
  });

  it("reports direct children", () => {
    expect(g.childrenOf("original")).toEqual(["remix"]);
  });

  it("flags over-attribution", () => {
    const over = new LineageGraph([
      { child: "x", parent: "p", weight: 0.7 },
      { child: "x", parent: "q", weight: 0.7 },
    ]);
    expect(over.isConserving("x")).toBe(false);
    expect(g.isConserving("answer")).toBe(true);
  });
});
