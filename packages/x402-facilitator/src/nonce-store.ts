/**
 * Replay protection for authorization nonces.
 *
 * EIP-3009 and Permit2 both reject a used nonce on-chain, but only after the
 * relayer has paid gas for the reverting transaction. The facilitator
 * therefore tracks every authorization it has claimed and refuses a second
 * settlement of the same one before touching the chain. `reserve` must be
 * atomic: in a multi-instance deployment back it with a shared store (Redis
 * SET NX, a Postgres unique index).
 *
 * States:
 *   pending   - claimed by an in-flight settle, nothing broadcast yet
 *   broadcast - a transaction was sent but did not confirm successfully; a
 *               retry of the SAME payload may reconcile against it
 *   settled   - confirmed on-chain (terminal)
 */

export type NonceState = "pending" | "broadcast" | "settled";

export interface NonceRecord {
  state: NonceState;
  txHash?: string;
}

export interface NonceStore {
  /** Atomically claim `key`. Returns false when it already exists in any state. */
  reserve(key: string): Promise<boolean>;
  /** A transaction was broadcast for `key` without a successful receipt. */
  markBroadcast(key: string, txHash: string): Promise<void>;
  /** Mark `key` settled on-chain (terminal). */
  markSettled(key: string, txHash: string): Promise<void>;
  /** Drop a `pending` claim after a failure that broadcast nothing. */
  release(key: string): Promise<void>;
  get(key: string): Promise<NonceRecord | undefined>;
}

/** Stable key for one authorization: chain + token + payer + nonce. */
export function nonceKey(parts: { caip2: string; asset: string; from: string; nonce: string }): string {
  return [parts.caip2, parts.asset.toLowerCase(), parts.from.toLowerCase(), parts.nonce.toLowerCase()].join("|");
}

/** Process-local store; suitable for one facilitator instance and tests. */
export class InMemoryNonceStore implements NonceStore {
  private readonly entries = new Map<string, NonceRecord>();

  async reserve(key: string): Promise<boolean> {
    if (this.entries.has(key)) return false;
    this.entries.set(key, { state: "pending" });
    return true;
  }

  async markBroadcast(key: string, txHash: string): Promise<void> {
    this.entries.set(key, { state: "broadcast", txHash });
  }

  async markSettled(key: string, txHash: string): Promise<void> {
    this.entries.set(key, { state: "settled", txHash });
  }

  async release(key: string): Promise<void> {
    if (this.entries.get(key)?.state === "pending") this.entries.delete(key);
  }

  async get(key: string): Promise<NonceRecord | undefined> {
    const record = this.entries.get(key);
    return record ? { ...record } : undefined;
  }
}
