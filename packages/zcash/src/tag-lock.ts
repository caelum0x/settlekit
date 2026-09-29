/**
 * Atomic tag assignment.
 *
 * Choosing a tag is read-then-write (read the tags other open sessions hold,
 * pick a free one, save), so two sessions locking quotes on the same payTo at
 * once could otherwise pick the same tag and an incoming payment would match
 * both. {@link saveWithUniqueTag} runs the whole read-pick-save under a
 * per-payTo lock (in-process mutex, or a Postgres advisory lock across
 * instances) and re-checks uniqueness after the save, moving to the next tag
 * on a collision.
 */
import type { SettlementQuote } from "@settlekit/common";
import { assignTag, TAG_MODULUS } from "./tag.js";

/** Serializes critical sections per key (a Zcash payTo address). */
export interface TagLock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/** In-process per-key mutex (single-instance / in-memory deployments). */
export function createInMemoryTagLock(): TagLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const run = previous.then(fn, fn);
      const tail = run.catch(() => undefined);
      tails.set(key, tail);
      try {
        return await run;
      } finally {
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}

/** `quote` (locked with tag 0) re-priced to carry `tag` zatoshis. */
export function withTag(baseQuote: SettlementQuote, tag: number): SettlementQuote {
  return { ...baseQuote, amountBase: (BigInt(baseQuote.amountBase) + BigInt(tag)).toString() };
}

export interface SaveWithUniqueTagInput<S> {
  lock: TagLock;
  payTo: string;
  sessionId: string;
  /** The quote locked with tag 0; the chosen tag is added to its amount. */
  baseQuote: SettlementQuote;
  /** Tags currently held by OTHER live sessions paying `payTo`. */
  takenTags(): Promise<ReadonlySet<number>>;
  /** Persist the session with `quote`; returns the saved session. */
  save(quote: SettlementQuote): Promise<S>;
  /** Collision retries after the post-save re-check (default 5). */
  maxAttempts?: number;
}

/**
 * Pick a tag free on `payTo`, save, then re-check nobody else holds it; on a
 * collision (a writer that bypassed the lock) move to the next free tag.
 */
export async function saveWithUniqueTag<S>(input: SaveWithUniqueTagInput<S>): Promise<S> {
  const maxAttempts = input.maxAttempts ?? 5;
  return input.lock.withLock(input.payTo, async () => {
    const avoid = new Set<number>();
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const taken = new Set([...(await input.takenTags()), ...avoid]);
      if (taken.size >= TAG_MODULUS) break;
      const tag = assignTag(input.sessionId, taken);
      const saved = await input.save(withTag(input.baseQuote, tag));
      if (!(await input.takenTags()).has(tag)) return saved;
      avoid.add(tag);
    }
    throw new Error("could not assign a unique Zcash amount tag; retry");
  });
}
