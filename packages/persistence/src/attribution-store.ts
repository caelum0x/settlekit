/**
 * Postgres-backed attribution stores: the provenance lineage graph
 * (`lepton_lineage_edges`) and issued proofs-of-citation
 * (`lepton_citation_proofs`). Canonical entities live in `metadata.__doc`;
 * columns are projections for graph queries and replay protection.
 */

import {
  and,
  eq,
  type Database,
  leptonCitationProofs,
  leptonLineageEdges,
} from "@settlekit/database";
import { uuid } from "@settlekit/common";
import type {
  CitationProof,
  LineageEdge,
  LineageStore,
  ProofStore,
} from "@settlekit/attribution";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgLineageStore implements LineageStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async addEdge(edge: LineageEdge): Promise<LineageEdge> {
    const projection = {
      childId: edge.child,
      parentId: edge.parent,
      metadata: packDoc(edge),
      createdAt: this.now(),
    };
    await this.db
      .insert(leptonLineageEdges)
      .values({ id: `lin_${uuid().replace(/-/g, "").slice(0, 24)}`, ...projection })
      .onConflictDoUpdate({
        target: [leptonLineageEdges.childId, leptonLineageEdges.parentId],
        set: { metadata: projection.metadata },
      });
    return edge;
  }

  async parentsOf(child: string): Promise<LineageEdge[]> {
    const rows = await this.db
      .select({ metadata: leptonLineageEdges.metadata })
      .from(leptonLineageEdges)
      .where(eq(leptonLineageEdges.childId, child));
    return unpackDocs<LineageEdge>(rows);
  }

  async childrenOf(parent: string): Promise<LineageEdge[]> {
    const rows = await this.db
      .select({ metadata: leptonLineageEdges.metadata })
      .from(leptonLineageEdges)
      .where(eq(leptonLineageEdges.parentId, parent));
    return unpackDocs<LineageEdge>(rows);
  }

  async allEdges(): Promise<LineageEdge[]> {
    const rows = await this.db
      .select({ metadata: leptonLineageEdges.metadata })
      .from(leptonLineageEdges);
    return unpackDocs<LineageEdge>(rows);
  }
}

export class PgProofStore implements ProofStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(proof: CitationProof): Promise<CitationProof> {
    const projection = {
      nonce: proof.nonce,
      agent: proof.agent,
      accessId: proof.accessId,
      metadata: packDoc(proof),
      createdAt: new Date(proof.issuedAt),
    };
    await this.db
      .insert(leptonCitationProofs)
      .values({ id: `prf_${uuid().replace(/-/g, "").slice(0, 24)}`, ...projection })
      .onConflictDoUpdate({ target: leptonCitationProofs.nonce, set: { metadata: projection.metadata } });
    return proof;
  }

  async findByNonce(nonce: string): Promise<CitationProof | undefined> {
    const rows = await this.db
      .select({ metadata: leptonCitationProofs.metadata })
      .from(leptonCitationProofs)
      .where(eq(leptonCitationProofs.nonce, nonce))
      .limit(1);
    return unpackDoc<CitationProof>(rows[0]) ?? undefined;
  }

  async listByAccess(accessId: string): Promise<CitationProof[]> {
    const rows = await this.db
      .select({ metadata: leptonCitationProofs.metadata })
      .from(leptonCitationProofs)
      .where(eq(leptonCitationProofs.accessId, accessId));
    return unpackDocs<CitationProof>(rows);
  }

  /**
   * Atomically claim a recorded nonce. The conditional `UPDATE ... WHERE
   * consumed = false RETURNING` flips the flag and reports a row only on the
   * first call, so concurrent sellers cannot both accept the same proof.
   */
  async consume(nonce: string): Promise<boolean> {
    const claimed = await this.db
      .update(leptonCitationProofs)
      .set({ consumed: true })
      .where(and(eq(leptonCitationProofs.nonce, nonce), eq(leptonCitationProofs.consumed, false)))
      .returning({ id: leptonCitationProofs.id });
    return claimed.length > 0;
  }
}
