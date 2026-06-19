/**
 * The provenance lineage graph.
 *
 * A weighted "derives-from" DAG. {@link computeAttributionShares} walks it the
 * way the citation-toll split walks the source graph — each node keeps the share
 * it does not route onward and passes the rest to the ancestors it derives from,
 * recursively — but expressed as fractions in [0, 1] rather than money, so any
 * consumer can use them: settle a payment, attribute a credit, or rank a result.
 *
 * The walk is cycle-safe (a node never re-enters its own path) and diamond-aware
 * (an ancestor reached by two paths accumulates both shares, recording the
 * shallowest depth).
 */

import {
  type Result,
  type SettleKitError,
  err,
  ok,
  validationError,
} from "@settlekit/common";
import type { AttributionShare, LineageEdge } from "./types.js";

/** Float comparison slack — provenance weights are small fractions, not money. */
const EPSILON = 1e-9;

/** Validate a single lineage edge: a real weight in (0, 1] with distinct ends. */
export function validateLineageEdge(edge: LineageEdge): Result<LineageEdge, SettleKitError> {
  if (edge.child === edge.parent) {
    return err(validationError(`lineage edge cannot point a work at itself (${edge.child})`));
  }
  if (!Number.isFinite(edge.weight) || edge.weight <= 0 || edge.weight > 1 + EPSILON) {
    return err(validationError(`lineage edge weight must be in (0, 1], got ${edge.weight}`));
  }
  return ok({ ...edge, weight: Math.min(edge.weight, 1) });
}

/**
 * A mutable, in-memory provenance DAG. Build it directly for tests, or snapshot
 * a {@link LineageStore} into one with {@link loadLineageGraph}.
 */
export class LineageGraph {
  /** child -> (parent -> edge), so re-adding the same pair replaces it. */
  private readonly out = new Map<string, Map<string, LineageEdge>>();
  /** parent -> set of children, for descendant queries. */
  private readonly incoming = new Map<string, Set<string>>();

  constructor(edges: readonly LineageEdge[] = []) {
    for (const edge of edges) {
      this.addEdge(edge);
    }
  }

  /** Add (or replace) a derives-from edge. Throws on an invalid weight/self-edge. */
  addEdge(edge: LineageEdge): this {
    const validated = validateLineageEdge(edge);
    if (!validated.ok) {
      throw validated.error;
    }
    const e = validated.value;
    let parents = this.out.get(e.child);
    if (parents === undefined) {
      parents = new Map();
      this.out.set(e.child, parents);
    }
    parents.set(e.parent, e);
    let children = this.incoming.get(e.parent);
    if (children === undefined) {
      children = new Set();
      this.incoming.set(e.parent, children);
    }
    children.add(e.child);
    return this;
  }

  /** Direct ancestors `child` derives from. */
  parentsOf(child: string): readonly LineageEdge[] {
    return [...(this.out.get(child)?.values() ?? [])];
  }

  /** Direct descendants that derive from `parent`. */
  childrenOf(parent: string): readonly string[] {
    return [...(this.incoming.get(parent) ?? [])];
  }

  /** Every edge in the graph. */
  edges(): readonly LineageEdge[] {
    const all: LineageEdge[] = [];
    for (const parents of this.out.values()) {
      all.push(...parents.values());
    }
    return all;
  }

  /** Every node id that appears as a child or a parent. */
  nodes(): readonly string[] {
    const ids = new Set<string>();
    for (const [child, parents] of this.out) {
      ids.add(child);
      for (const parent of parents.keys()) {
        ids.add(parent);
      }
    }
    return [...ids];
  }

  /** All transitive ancestors of `id` (cycle-safe), nearest excluded of self. */
  ancestors(id: string): readonly string[] {
    const seen = new Set<string>();
    const visit = (node: string): void => {
      for (const edge of this.parentsOf(node)) {
        if (!seen.has(edge.parent)) {
          seen.add(edge.parent);
          visit(edge.parent);
        }
      }
    };
    visit(id);
    seen.delete(id);
    return [...seen];
  }

  /**
   * Whether a node over-attributes — its outgoing edge weights sum past 100%,
   * which would leave it a negative self-share. Useful as a data-integrity check
   * before settling against the graph.
   */
  isConserving(id: string): boolean {
    const total = this.parentsOf(id).reduce((sum, e) => sum + e.weight, 0);
    return total <= 1 + EPSILON;
  }
}

/**
 * Fractional attribution of `rootId`'s value across its provenance lineage.
 *
 * Returns one {@link AttributionShare} per node that retains a positive share
 * (including the root itself). Shares sum to 1 when every node is conserving.
 */
export function computeAttributionShares(
  graph: LineageGraph,
  rootId: string,
): readonly AttributionShare[] {
  const acc = new Map<string, { share: number; depth: number }>();

  const add = (nodeId: string, share: number, depth: number): void => {
    const existing = acc.get(nodeId);
    if (existing === undefined) {
      acc.set(nodeId, { share, depth });
    } else {
      existing.share += share;
      existing.depth = Math.min(existing.depth, depth);
    }
  };

  const recurse = (id: string, amount: number, depth: number, path: ReadonlySet<string>): void => {
    const edges = graph
      .parentsOf(id)
      .filter((e) => e.parent !== id && !path.has(e.parent));

    let routed = 0;
    for (const edge of edges) {
      routed += amount * edge.weight;
    }
    add(id, amount - routed, depth);

    const nextPath = new Set(path).add(id);
    for (const edge of edges) {
      recurse(edge.parent, amount * edge.weight, depth + 1, nextPath);
    }
  };

  recurse(rootId, 1, 0, new Set());

  return [...acc.entries()]
    .map(([nodeId, a]) => ({ nodeId, share: a.share, depth: a.depth }))
    .filter((s) => s.share > EPSILON)
    .sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId));
}
