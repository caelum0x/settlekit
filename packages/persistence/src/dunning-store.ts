/**
 * Postgres-backed {@link DunningStore}, keyed by `subscriptionId` (one campaign
 * per subscription). The canonical {@link DunningState} (schedule + attempt
 * history) lives in `metadata.__doc`; status / attempt / next-attempt columns
 * are projected so `listActive` / `listDue` run as SQL filters.
 */
import { and, eq, lte, type Database, dunningStates } from "@settlekit/database";
import { generateSecret } from "@settlekit/common";
import type { DunningState, DunningStore } from "@settlekit/dunning";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** Convert an optional ISO timestamp to a Date for a `timestamptz` column. */
function toDate(iso: string | undefined): Date | null {
  return iso ? new Date(iso) : null;
}

export class PgDunningStore implements DunningStore {
  constructor(private readonly db: Database) {}

  async save(state: DunningState): Promise<DunningState> {
    const projection = {
      status: state.status,
      attempt: state.attempt,
      nextAttemptAt: toDate(state.nextAttemptAt),
      metadata: packDoc(state),
    };
    await this.db
      .insert(dunningStates)
      .values({ id: `dun_${generateSecret(12)}`, subscriptionId: state.subscriptionId, ...projection })
      .onConflictDoUpdate({ target: dunningStates.subscriptionId, set: projection });
    return state;
  }

  async findBySubscription(subscriptionId: string): Promise<DunningState | undefined> {
    const rows = await this.db
      .select({ metadata: dunningStates.metadata })
      .from(dunningStates)
      .where(eq(dunningStates.subscriptionId, subscriptionId))
      .limit(1);
    return unpackDoc<DunningState>(rows[0]) ?? undefined;
  }

  async listActive(): Promise<DunningState[]> {
    const rows = await this.db
      .select({ metadata: dunningStates.metadata })
      .from(dunningStates)
      .where(eq(dunningStates.status, "active"));
    return unpackDocs<DunningState>(rows);
  }

  async listDue(now: Date): Promise<DunningState[]> {
    const rows = await this.db
      .select({ metadata: dunningStates.metadata })
      .from(dunningStates)
      .where(and(eq(dunningStates.status, "active"), lte(dunningStates.nextAttemptAt, now)));
    return unpackDocs<DunningState>(rows);
  }

  async listAll(): Promise<DunningState[]> {
    const rows = await this.db.select({ metadata: dunningStates.metadata }).from(dunningStates);
    return unpackDocs<DunningState>(rows);
  }
}
