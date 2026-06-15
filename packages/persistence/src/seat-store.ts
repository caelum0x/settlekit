/**
 * Postgres-backed {@link SeatStore} (@settlekit/saas). The canonical SeatRecord
 * aggregate lives in `metadata.__doc`; typed columns are projected for querying.
 *
 * A SeatRecord is keyed by its customer id, but the table's primary key is a
 * prefixed id, so we derive a deterministic per-customer row id ("seat_<cid>")
 * and upsert. `subscription_id` is null here — the aggregate isn't tied to a
 * single subscription row — and the document remains the source of truth.
 */
import { eq, type Database, saasSeats } from "@settlekit/database";
import type { SeatStore, SeatRecord } from "@settlekit/saas";
import { packDoc, unpackDoc } from "./codec.js";

function seatRowId(customerId: string): string {
  return `seat_${customerId}`;
}

export class PgSeatStore implements SeatStore {
  constructor(private readonly db: Database) {}

  async get(customerId: string): Promise<SeatRecord | null> {
    const rows = await this.db
      .select({ metadata: saasSeats.metadata })
      .from(saasSeats)
      .where(eq(saasSeats.id, seatRowId(customerId)))
      .limit(1);
    return unpackDoc<SeatRecord>(rows[0]);
  }

  async save(record: SeatRecord): Promise<SeatRecord> {
    const projection = {
      subscriptionId: null,
      customerId: record.customerId,
      status: "active",
      metadata: packDoc(record),
    };
    await this.db
      .insert(saasSeats)
      .values({ id: seatRowId(record.customerId), ...projection })
      .onConflictDoUpdate({ target: saasSeats.id, set: projection });
    return record;
  }
}
