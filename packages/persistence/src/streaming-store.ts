/**
 * Postgres-backed {@link StreamStore}. The canonical {@link StreamRecord} lives
 * in `metadata.__doc`; payer/payee/state/amount columns are projected for the
 * settlement worker's stopped-stream refund sweep.
 */

import { eq, type Database, leptonStreams } from "@settlekit/database";
import type { StreamRecord, StreamState, StreamStore } from "@settlekit/streaming";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgStreamStore implements StreamStore {
  constructor(private readonly db: Database) {}

  async save(record: StreamRecord): Promise<StreamRecord> {
    const projection = {
      payer: record.payer,
      payee: record.payee,
      network: record.network,
      ratePerSecondUsdc: record.ratePerSecondUsdc,
      reserveUsdc: record.reserveUsdc,
      state: record.state,
      accruedUsdc: record.accruedUsdc,
      settledUsdc: record.settledUsdc,
      metadata: packDoc(record),
      updatedAt: new Date(record.updatedAt),
    };
    await this.db
      .insert(leptonStreams)
      .values({ id: record.id, createdAt: new Date(record.createdAt), ...projection })
      .onConflictDoUpdate({ target: leptonStreams.id, set: projection });
    return record;
  }

  async findById(id: string): Promise<StreamRecord | undefined> {
    const rows = await this.db
      .select({ metadata: leptonStreams.metadata })
      .from(leptonStreams)
      .where(eq(leptonStreams.id, id))
      .limit(1);
    return unpackDoc<StreamRecord>(rows[0]) ?? undefined;
  }

  async listByState(state: StreamState): Promise<StreamRecord[]> {
    const rows = await this.db
      .select({ metadata: leptonStreams.metadata })
      .from(leptonStreams)
      .where(eq(leptonStreams.state, state));
    return unpackDocs<StreamRecord>(rows);
  }

  async markRefunded(id: string, refundedAt: string): Promise<void> {
    const rows = await this.db
      .select({ metadata: leptonStreams.metadata })
      .from(leptonStreams)
      .where(eq(leptonStreams.id, id))
      .limit(1);
    const record = unpackDoc<StreamRecord>(rows[0]);
    if (record === null) {
      return;
    }
    const updated: StreamRecord = { ...record, refundedAt };
    await this.db
      .update(leptonStreams)
      .set({ metadata: packDoc(updated) })
      .where(eq(leptonStreams.id, id));
  }
}
