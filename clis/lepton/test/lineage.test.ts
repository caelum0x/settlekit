import { describe, expect, it } from "vitest";
import { LineageGraph, computeAttributionShares } from "@settlekit/attribution";
import { SettleKitError } from "@settlekit/common";
import { parseEdgeToken, parseEdgesFile } from "../src/commands/lineage.js";

const EPSILON = 1e-9;

describe("parseEdgeToken", () => {
  it("parses child:parent:weight into a LineageEdge", () => {
    expect(parseEdgeToken("b:a:0.5")).toEqual({ child: "b", parent: "a", weight: 0.5 });
  });

  it("throws on the wrong number of parts", () => {
    expect(() => parseEdgeToken("b:a")).toThrow(/child:parent:weight/);
  });

  it("throws on a non-numeric weight", () => {
    expect(() => parseEdgeToken("b:a:x")).toThrow(/not a number/);
  });

  it("throws SettleKitError on an out-of-range weight", () => {
    expect(() => parseEdgeToken("b:a:2")).toThrow(SettleKitError);
  });

  it("throws on a self-edge", () => {
    expect(() => parseEdgeToken("a:a:0.5")).toThrow(SettleKitError);
  });
});

describe("parseEdgesFile", () => {
  it("parses a JSON array of edges", () => {
    const edges = parseEdgesFile(JSON.stringify([{ child: "b", parent: "a", weight: 0.5 }]));
    expect(edges).toEqual([{ child: "b", parent: "a", weight: 0.5 }]);
  });

  it("throws when the JSON is not an array", () => {
    expect(() => parseEdgesFile("{}")).toThrow(/array/);
  });

  it("throws on a malformed entry", () => {
    expect(() => parseEdgesFile(JSON.stringify([{ child: "b" }]))).toThrow(/not a valid LineageEdge/);
  });
});

describe("computeAttributionShares over parsed edges", () => {
  it("conserves: shares sum to ~1 across a 3-node graph", () => {
    // root c routes half its value to b; b routes half of what it keeps to a.
    // Each node keeps a non-zero remainder, so all three appear and shares sum
    // to exactly 1 (value is conserved, never created or destroyed).
    const edges = ["c:b:0.5", "b:a:0.5"].map(parseEdgeToken);
    const graph = new LineageGraph(edges);
    const shares = computeAttributionShares(graph, "c");
    const total = shares.reduce((sum, s) => sum + s.share, 0);
    expect(Math.abs(total - 1)).toBeLessThan(EPSILON);
    expect(shares.map((s) => s.nodeId).sort()).toEqual(["a", "b", "c"]);
  });

  it("splits partial weights and keeps the remainder at the root", () => {
    const edges = ["b:a:0.4"].map(parseEdgeToken);
    const graph = new LineageGraph(edges);
    const shares = computeAttributionShares(graph, "b");
    const byNode = Object.fromEntries(shares.map((s) => [s.nodeId, s.share]));
    expect(Math.abs((byNode.b ?? 0) - 0.6)).toBeLessThan(EPSILON);
    expect(Math.abs((byNode.a ?? 0) - 0.4)).toBeLessThan(EPSILON);
  });
});
