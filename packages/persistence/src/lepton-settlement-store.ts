/**
 * Postgres-backed durability for the settlement spine:
 *  - {@link PgIdempotencyStore} persists settlement receipts keyed by reference,
 *    so a retried settlement is a no-op across process restarts.
 *  - {@link PgNonceStore} persists one-time x402 nonces for replay protection.
 *
 * The canonical {@link SettlementReceipt} lives in `metadata.__doc`; columns are
 * projections for status queries and reconciliation.
 */

import { and, eq, isNull, type Database, leptonNonces, leptonSettlements } from "@settlekit/database";
import { generateSecret, uuid } from "@settlekit/common";
import type {
  NonceStore,
  SettlementReceipt,
  SettlementReceiptStore,
  SettlementStatus,
} from "@settlekit/settlement-core";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

export class PgIdempotencyStore implements SettlementReceiptStore {
  constructor(private readonly db: Database) {}

  async get(reference: string): Promise<SettlementReceipt | undefined> {
    const rows = await this.db
      .select({ metadata: leptonSettlements.metadata })
      .from(leptonSettlements)
      .where(eq(leptonSettlements.reference, reference))
      .limit(1);
    return unpackDoc<SettlementReceipt>(rows[0]) ?? undefined;
  }

  async put(receipt: SettlementReceipt): Promise<void> {
    const projection = {
      reference: receipt.reference,
      recipient: receipt.to,
      amount: receipt.amount.amount,
      network: receipt.network,
      status: receipt.status,
      provider: receipt.provider,
      txHash: receipt.txHash ?? null,
      batchId: receipt.batchId ?? null,
      createdAt: new Date(receipt.createdAt),
      settledAt: receipt.settledAt ? new Date(receipt.settledAt) : null,
      metadata: packDoc(receipt),
    };
    await this.db
      .insert(leptonSettlements)
      .values({ id: receipt.id, ...projection })
      .onConflictDoUpdate({ target: leptonSettlements.reference, set: projection });
  }

  /**
   * Atomically claim a reference by inserting its pending receipt; the unique
   * constraint on `reference` makes this safe across processes. Returns true
   * only when this caller inserted the row (and must therefore settle).
   */
  async reserve(pending: SettlementReceipt): Promise<boolean> {
    const rows = await this.db
      .insert(leptonSettlements)
      .values({
        id: pending.id,
        reference: pending.reference,
        recipient: pending.to,
        amount: pending.amount.amount,
        network: pending.network,
        status: pending.status,
        provider: pending.provider,
        txHash: null,
        batchId: null,
        createdAt: new Date(pending.createdAt),
        settledAt: null,
        metadata: packDoc(pending),
      })
      .onConflictDoNothing({ target: leptonSettlements.reference })
      .returning({ id: leptonSettlements.id });
    return rows.length > 0;
  }

  /** Remove a still-pending claim so a failed settlement can be retried. */
  async release(reference: string): Promise<void> {
    await this.db
      .delete(leptonSettlements)
      .where(and(eq(leptonSettlements.reference, reference), eq(leptonSettlements.status, "pending")));
  }

  async listByStatus(status: SettlementStatus): Promise<SettlementReceipt[]> {
    const rows = await this.db
      .select({ metadata: leptonSettlements.metadata })
      .from(leptonSettlements)
      .where(eq(leptonSettlements.status, status));
    return unpackDocs<SettlementReceipt>(rows);
  }
}

export class PgNonceStore implements NonceStore {
  constructor(private readonly db: Database) {}

  async issue(): Promise<string> {
    const nonce = generateSecret(16);
    await this.db
      .insert(leptonNonces)
      .values({ id: `nnc_${uuid().replace(/-/g, "").slice(0, 24)}`, nonce, createdAt: new Date() });
    return nonce;
  }

  async consume(nonce: string): Promise<boolean> {
    const updated = await this.db
      .update(leptonNonces)
      .set({ consumedAt: new Date() })
      .where(and(eq(leptonNonces.nonce, nonce), isNull(leptonNonces.consumedAt)))
      .returning({ nonce: leptonNonces.nonce });
    return updated.length > 0;
  }
}
