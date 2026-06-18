/**
 * Postgres-backed citation-toll stores: sources (with their citation edges) and
 * per-access royalty legs. Canonical entities live in `metadata.__doc`; columns
 * are projections for queries and the settlement worker / creator dashboards.
 */

import { eq, type Database, leptonCitations, leptonRoyaltyLegs, leptonSources } from "@settlekit/database";
import { uuid } from "@settlekit/common";
import type {
  PersistedRoyaltyLeg,
  RoyaltyLegStore,
  Source,
  SourceStore,
} from "@settlekit/citation-toll";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgSourceStore implements SourceStore {
  constructor(private readonly db: Database) {}

  async save(source: Source): Promise<Source> {
    const projection = {
      organizationId: source.organizationId,
      title: source.title,
      authorWallet: source.authorWallet,
      network: source.network,
      priceUsdc: source.priceUsdc,
      summary: source.summary,
      metadata: packDoc(source),
    };
    await this.db
      .insert(leptonSources)
      .values({ id: source.id, ...projection })
      .onConflictDoUpdate({ target: leptonSources.id, set: projection });

    // Refresh the projected citation edges for this source.
    await this.db.delete(leptonCitations).where(eq(leptonCitations.sourceId, source.id));
    if (source.cites.length > 0) {
      await this.db.insert(leptonCitations).values(
        source.cites.map((c) => ({
          id: `cit_${uuid().replace(/-/g, "").slice(0, 24)}`,
          sourceId: source.id,
          citedSourceId: c.sourceId,
          shareBps: c.shareBps,
          createdAt: new Date(),
        })),
      );
    }
    return source;
  }

  async findById(id: string): Promise<Source | undefined> {
    const rows = await this.db
      .select({ metadata: leptonSources.metadata })
      .from(leptonSources)
      .where(eq(leptonSources.id, id))
      .limit(1);
    return unpackDoc<Source>(rows[0]) ?? undefined;
  }

  async listByOrganization(organizationId: string): Promise<Source[]> {
    const rows = await this.db
      .select({ metadata: leptonSources.metadata })
      .from(leptonSources)
      .where(eq(leptonSources.organizationId, organizationId));
    return unpackDocs<Source>(rows);
  }

  async listAll(): Promise<Source[]> {
    const rows = await this.db.select({ metadata: leptonSources.metadata }).from(leptonSources);
    return unpackDocs<Source>(rows);
  }
}

export class PgRoyaltyLegStore implements RoyaltyLegStore {
  constructor(private readonly db: Database) {}

  async append(leg: PersistedRoyaltyLeg): Promise<PersistedRoyaltyLeg> {
    await this.db.insert(leptonRoyaltyLegs).values({
      id: leg.id,
      sourceId: leg.sourceId,
      accessId: leg.accessId,
      wallet: leg.wallet,
      amount: leg.amount.amount,
      depth: leg.depth,
      settlementId: leg.settlementId ?? null,
      status: leg.status,
      metadata: packDoc(leg),
      createdAt: new Date(leg.createdAt),
    });
    return leg;
  }

  async listByAccess(accessId: string): Promise<PersistedRoyaltyLeg[]> {
    const rows = await this.db
      .select({ metadata: leptonRoyaltyLegs.metadata })
      .from(leptonRoyaltyLegs)
      .where(eq(leptonRoyaltyLegs.accessId, accessId));
    return unpackDocs<PersistedRoyaltyLeg>(rows);
  }

  async listByWallet(wallet: string): Promise<PersistedRoyaltyLeg[]> {
    const rows = await this.db
      .select({ metadata: leptonRoyaltyLegs.metadata })
      .from(leptonRoyaltyLegs)
      .where(eq(leptonRoyaltyLegs.wallet, wallet));
    return unpackDocs<PersistedRoyaltyLeg>(rows);
  }

  async listPending(): Promise<PersistedRoyaltyLeg[]> {
    const rows = await this.db
      .select({ metadata: leptonRoyaltyLegs.metadata })
      .from(leptonRoyaltyLegs)
      .where(eq(leptonRoyaltyLegs.status, "pending"));
    return unpackDocs<PersistedRoyaltyLeg>(rows);
  }

  async markSettled(legId: string, settlementId: string): Promise<void> {
    const rows = await this.db
      .select({ metadata: leptonRoyaltyLegs.metadata })
      .from(leptonRoyaltyLegs)
      .where(eq(leptonRoyaltyLegs.id, legId))
      .limit(1);
    const leg = unpackDoc<PersistedRoyaltyLeg>(rows[0]);
    if (leg === null) {
      return;
    }
    const updated: PersistedRoyaltyLeg = { ...leg, status: "settled", settlementId };
    await this.db
      .update(leptonRoyaltyLegs)
      .set({ status: "settled", settlementId, metadata: packDoc(updated) })
      .where(eq(leptonRoyaltyLegs.id, legId));
  }
}
