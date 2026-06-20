import { describe, expect, it } from "vitest";
import {
  InMemoryLineageStore,
  InMemoryProofStore,
  loadLineageGraph,
} from "../src/store.js";
import { computeAttributionShares } from "../src/lineage-graph.js";
import { issueCitationProof } from "../src/proof.js";

describe("InMemoryLineageStore", () => {
  it("persists edges, dedupes a pair, and snapshots into a graph", async () => {
    const store = new InMemoryLineageStore();
    await store.addEdge({ child: "answer", parent: "src", weight: 0.3 });
    await store.addEdge({ child: "answer", parent: "src", weight: 0.4 }); // replaces
    await store.addEdge({ child: "src", parent: "root", weight: 0.5 });

    expect((await store.parentsOf("answer")).length).toBe(1);
    expect((await store.parentsOf("answer"))[0]?.weight).toBe(0.4);
    expect((await store.childrenOf("root")).map((e) => e.child)).toEqual(["src"]);

    const graph = await loadLineageGraph(store);
    const shares = computeAttributionShares(graph, "answer");
    expect(shares.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(shares.map((s) => s.nodeId).sort()).toEqual(["answer", "root", "src"]);
  });
});

describe("InMemoryProofStore", () => {
  it("records and finds proofs by nonce and access", async () => {
    const store = new InMemoryProofStore();
    const proof = issueCitationProof({ agent: "a1", sourceIds: ["s1"], accessId: "acc_1" }, "secret");
    await store.record(proof);
    expect((await store.findByNonce(proof.nonce))?.accessId).toBe("acc_1");
    expect((await store.listByAccess("acc_1")).length).toBe(1);
  });

  it("consume() succeeds once then rejects replays", async () => {
    const store = new InMemoryProofStore();
    expect(await store.consume("nonce-x")).toBe(true);
    expect(await store.consume("nonce-x")).toBe(false);
  });
});
