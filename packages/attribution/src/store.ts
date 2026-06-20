/**
 * Persistence interfaces for attribution.
 *
 * {@link LineageStore} persists the provenance DAG; {@link loadLineageGraph}
 * snapshots it into an in-memory {@link LineageGraph} for the (synchronous)
 * attribution walk. {@link ProofStore} records issued proofs for audit and
 * gives stateless sellers replay protection via {@link ProofStore.consume}.
 * In-memory implementations live here for dev/tests; the Pg-backed stores live
 * in @settlekit/persistence (over the `lepton_*` tables).
 */

import { LineageGraph } from "./lineage-graph.js";
import type { CitationProof, LineageEdge } from "./types.js";

/** Async store for provenance lineage edges. */
export interface LineageStore {
  /** Insert or replace the edge for a (child, parent) pair. */
  addEdge(edge: LineageEdge): Promise<LineageEdge>;
  /** Direct ancestors `child` derives from. */
  parentsOf(child: string): Promise<LineageEdge[]>;
  /** Direct descendants that derive from `parent`. */
  childrenOf(parent: string): Promise<LineageEdge[]>;
  /** Every edge (used to snapshot the graph for the attribution walk). */
  allEdges(): Promise<LineageEdge[]>;
}

/** Async store for issued proofs-of-citation. */
export interface ProofStore {
  record(proof: CitationProof): Promise<CitationProof>;
  findByNonce(nonce: string): Promise<CitationProof | undefined>;
  listByAccess(accessId: string): Promise<CitationProof[]>;
  /**
   * Atomically claim a nonce: returns `true` the first time it is seen and
   * `false` on every replay. A seller calls this after verifying the signature
   * to reject a proof that is being presented twice.
   */
  consume(nonce: string): Promise<boolean>;
}

/** Snapshot a {@link LineageStore} into a synchronous {@link LineageGraph}. */
export async function loadLineageGraph(store: LineageStore): Promise<LineageGraph> {
  return new LineageGraph(await store.allEdges());
}

/** In-memory {@link LineageStore} (dev/tests). */
export class InMemoryLineageStore implements LineageStore {
  /** `${child}|${parent}` -> edge, so re-adding a pair replaces it. */
  private readonly edges = new Map<string, LineageEdge>();

  async addEdge(edge: LineageEdge): Promise<LineageEdge> {
    this.edges.set(`${edge.child}|${edge.parent}`, edge);
    return edge;
  }

  async parentsOf(child: string): Promise<LineageEdge[]> {
    return [...this.edges.values()].filter((e) => e.child === child);
  }

  async childrenOf(parent: string): Promise<LineageEdge[]> {
    return [...this.edges.values()].filter((e) => e.parent === parent);
  }

  async allEdges(): Promise<LineageEdge[]> {
    return [...this.edges.values()];
  }
}

/** In-memory {@link ProofStore} (dev/tests). */
export class InMemoryProofStore implements ProofStore {
  private readonly byNonce = new Map<string, CitationProof>();
  private readonly consumed = new Set<string>();

  async record(proof: CitationProof): Promise<CitationProof> {
    this.byNonce.set(proof.nonce, proof);
    return proof;
  }

  async findByNonce(nonce: string): Promise<CitationProof | undefined> {
    return this.byNonce.get(nonce);
  }

  async listByAccess(accessId: string): Promise<CitationProof[]> {
    return [...this.byNonce.values()].filter((p) => p.accessId === accessId);
  }

  async consume(nonce: string): Promise<boolean> {
    if (this.consumed.has(nonce)) {
      return false;
    }
    this.consumed.add(nonce);
    return true;
  }
}
