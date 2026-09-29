/**
 * Postgres-backed replay store for the self-hosted x402 facilitator
 * (structurally implements `NonceStore` from @settlekit/x402-facilitator).
 *
 * `reserve` is `INSERT ... ON CONFLICT DO NOTHING RETURNING key` on the
 * primary key, so exactly one instance claims an authorization even when
 * several API replicas race on the same payload.
 */
import { and, eq, x402Nonces, type Database } from "@settlekit/database";

export type X402NonceState = "pending" | "broadcast" | "settled";

export interface X402NonceRecord {
  state: X402NonceState;
  txHash?: string;
}

export class PgX402NonceStore {
  constructor(private readonly db: Database) {}

  async reserve(key: string): Promise<boolean> {
    const rows = await this.db
      .insert(x402Nonces)
      .values({ key, state: "pending" })
      .onConflictDoNothing({ target: x402Nonces.key })
      .returning({ key: x402Nonces.key });
    return rows.length > 0;
  }

  async markBroadcast(key: string, txHash: string): Promise<void> {
    await this.upsert(key, "broadcast", txHash);
  }

  async markSettled(key: string, txHash: string): Promise<void> {
    await this.upsert(key, "settled", txHash);
  }

  async release(key: string): Promise<void> {
    await this.db.delete(x402Nonces).where(and(eq(x402Nonces.key, key), eq(x402Nonces.state, "pending")));
  }

  async get(key: string): Promise<X402NonceRecord | undefined> {
    const rows = await this.db
      .select({ state: x402Nonces.state, txHash: x402Nonces.txHash })
      .from(x402Nonces)
      .where(eq(x402Nonces.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return undefined;
    return { state: row.state as X402NonceState, ...(row.txHash ? { txHash: row.txHash } : {}) };
  }

  private async upsert(key: string, state: X402NonceState, txHash: string): Promise<void> {
    const now = new Date();
    await this.db
      .insert(x402Nonces)
      .values({ key, state, txHash, updatedAt: now })
      .onConflictDoUpdate({ target: x402Nonces.key, set: { state, txHash, updatedAt: now } });
  }
}
