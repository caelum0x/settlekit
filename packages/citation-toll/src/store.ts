/**
 * Persistence interfaces for citation tolls.
 *
 * The recursive split engine ({@link computeRoyaltyDistribution}) needs a
 * synchronous {@link SourceRegistry} to walk the lineage graph. Production
 * sources live in Postgres, so {@link SourceStore} is the async store and
 * {@link loadSourceRegistry} snapshots it into an in-memory registry for the
 * (fast, synchronous) split computation. {@link RoyaltyLegStore} persists the
 * per-access payout legs for the settlement worker and creator dashboards.
 */

import type { PaymentNetwork } from "@settlekit/common";
import { InMemorySourceRegistry, type SourceRegistry } from "./registry.js";
import type { RoyaltyLeg, Source } from "./types.js";

/** Async store for sources. */
export interface SourceStore {
  save(source: Source): Promise<Source>;
  findById(id: string): Promise<Source | undefined>;
  listByOrganization(organizationId: string): Promise<Source[]>;
  listAll(): Promise<Source[]>;
}

/** A persisted royalty leg (one recipient's cut of one paid access). */
export interface PersistedRoyaltyLeg extends RoyaltyLeg {
  id: string;
  /** The paid-access event this leg belongs to. */
  accessId: string;
  /** Settlement network the payout settles on. */
  network: PaymentNetwork;
  /** Settlement receipt id once paid out. */
  settlementId?: string;
  status: "pending" | "settled" | "failed";
  createdAt: string;
}

/** Async store for royalty legs. */
export interface RoyaltyLegStore {
  append(leg: PersistedRoyaltyLeg): Promise<PersistedRoyaltyLeg>;
  listByAccess(accessId: string): Promise<PersistedRoyaltyLeg[]>;
  listByWallet(wallet: string): Promise<PersistedRoyaltyLeg[]>;
  listPending(): Promise<PersistedRoyaltyLeg[]>;
  /** Mark a leg paid out, recording the settlement receipt id. */
  markSettled(legId: string, settlementId: string): Promise<void>;
}

/** Snapshot a {@link SourceStore} into a synchronous {@link SourceRegistry} for
 * the split engine. Pass `ids` to load only a relevant slice of the graph. */
export async function loadSourceRegistry(store: SourceStore): Promise<SourceRegistry> {
  const registry = new InMemorySourceRegistry();
  for (const source of await store.listAll()) {
    registry.add(source);
  }
  return registry;
}

/** In-memory {@link SourceStore} (dev/tests). */
export class InMemorySourceStore implements SourceStore {
  private readonly sources = new Map<string, Source>();

  async save(source: Source): Promise<Source> {
    this.sources.set(source.id, source);
    return source;
  }

  async findById(id: string): Promise<Source | undefined> {
    return this.sources.get(id);
  }

  async listByOrganization(organizationId: string): Promise<Source[]> {
    return [...this.sources.values()].filter((s) => s.organizationId === organizationId);
  }

  async listAll(): Promise<Source[]> {
    return [...this.sources.values()];
  }
}

/** In-memory {@link RoyaltyLegStore} (dev/tests). */
export class InMemoryRoyaltyLegStore implements RoyaltyLegStore {
  private readonly legs: PersistedRoyaltyLeg[] = [];

  async append(leg: PersistedRoyaltyLeg): Promise<PersistedRoyaltyLeg> {
    this.legs.push(leg);
    return leg;
  }

  async listByAccess(accessId: string): Promise<PersistedRoyaltyLeg[]> {
    return this.legs.filter((l) => l.accessId === accessId);
  }

  async listByWallet(wallet: string): Promise<PersistedRoyaltyLeg[]> {
    return this.legs.filter((l) => l.wallet.toLowerCase() === wallet.toLowerCase());
  }

  async listPending(): Promise<PersistedRoyaltyLeg[]> {
    return this.legs.filter((l) => l.status === "pending");
  }

  async markSettled(legId: string, settlementId: string): Promise<void> {
    const index = this.legs.findIndex((l) => l.id === legId);
    if (index >= 0) {
      const prev = this.legs[index];
      if (prev !== undefined) {
        this.legs[index] = { ...prev, status: "settled", settlementId };
      }
    }
  }
}
