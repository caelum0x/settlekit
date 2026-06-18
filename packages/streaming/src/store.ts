/**
 * Persistence for payment streams. A {@link StreamRecord} is the serializable
 * projection of a stream's meter (from {@link PaymentStream.snapshot}); the
 * settlement worker reads stopped streams to refund the reserved-but-unused
 * remainder.
 */

import { type IsoTimestamp, type PaymentNetwork, toIso } from "@settlekit/common";
import { PaymentStream } from "./stream.js";
import type { StreamState } from "./types.js";

/** A serializable snapshot of a stream's meter and parties. */
export interface StreamRecord {
  id: string;
  payer: string;
  payee: string;
  network: PaymentNetwork;
  ratePerSecondUsdc: string;
  reserveUsdc: string;
  state: StreamState;
  accruedUsdc: string;
  settledUsdc: string;
  refundableUsdc: string;
  refundedAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

/** Project a live {@link PaymentStream} into a persistable {@link StreamRecord}. */
export function recordFromStream(stream: PaymentStream, at: Date = new Date()): StreamRecord {
  const snap = stream.snapshot();
  const iso = toIso(at);
  return {
    id: snap.id,
    payer: stream.payer,
    payee: stream.payee,
    network: stream.network,
    ratePerSecondUsdc: snap.ratePerSecondUsdc,
    reserveUsdc: snap.reserveUsdc,
    state: snap.state,
    accruedUsdc: snap.accruedUsdc,
    settledUsdc: snap.settledUsdc,
    refundableUsdc: snap.refundableUsdc,
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Async store for stream records. */
export interface StreamStore {
  save(record: StreamRecord): Promise<StreamRecord>;
  findById(id: string): Promise<StreamRecord | undefined>;
  listByState(state: StreamState): Promise<StreamRecord[]>;
  /** Record that a stream's unused reserve has been refunded. */
  markRefunded(id: string, refundedAt: IsoTimestamp): Promise<void>;
}

/** In-memory {@link StreamStore} (dev/tests). */
export class InMemoryStreamStore implements StreamStore {
  private readonly records = new Map<string, StreamRecord>();

  async save(record: StreamRecord): Promise<StreamRecord> {
    const existing = this.records.get(record.id);
    const merged: StreamRecord =
      existing !== undefined ? { ...record, createdAt: existing.createdAt } : record;
    this.records.set(record.id, merged);
    return merged;
  }

  async findById(id: string): Promise<StreamRecord | undefined> {
    return this.records.get(id);
  }

  async listByState(state: StreamState): Promise<StreamRecord[]> {
    return [...this.records.values()].filter((r) => r.state === state);
  }

  async markRefunded(id: string, refundedAt: IsoTimestamp): Promise<void> {
    const existing = this.records.get(id);
    if (existing !== undefined) {
      this.records.set(id, { ...existing, refundedAt });
    }
  }
}
