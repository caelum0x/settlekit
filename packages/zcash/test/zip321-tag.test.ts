import { describe, expect, it } from "vitest";
import { assignTag, baseTag, buildZip321Uri, createInMemoryTagLock, formatZecAmount, saveWithUniqueTag, TAG_MODULUS } from "../src/index.js";

const T1 = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";

describe("ZIP-321 URIs", () => {
  it("renders golden URIs with trimmed 8-dp amounts", () => {
    expect(buildZip321Uri({ address: T1, amountZats: 1_736_402n })).toBe(`zcash:${T1}?amount=0.01736402`);
    expect(buildZip321Uri({ address: T1, amountZats: 100_000_000n })).toBe(`zcash:${T1}?amount=1`);
    expect(buildZip321Uri({ address: T1, amountZats: 150_000_000n, label: "SettleKit order", message: "cs_1 & more" })).toBe(
      `zcash:${T1}?amount=1.5&label=SettleKit%20order&message=cs_1%20%26%20more`,
    );
  });

  it("formats amounts exactly", () => {
    expect(formatZecAmount(1n)).toBe("0.00000001");
    expect(formatZecAmount(123_456_789_000n)).toBe("1234.56789");
  });

  it("rejects shielded addresses and non-positive amounts", () => {
    expect(() => buildZip321Uri({ address: "zs1abc", amountZats: 1n })).toThrow(/shielded/);
    expect(() => buildZip321Uri({ address: T1, amountZats: 0n })).toThrow(/positive/);
  });
});

describe("amount tags", () => {
  it("is deterministic and within range", () => {
    const tag = baseTag("cs_abc");
    expect(tag).toBe(baseTag("cs_abc"));
    expect(tag).toBeGreaterThanOrEqual(0);
    expect(tag).toBeLessThan(TAG_MODULUS);
  });

  it("bumps past tags already taken on the same address", () => {
    const tag = baseTag("cs_abc");
    const next = (tag + 1) % TAG_MODULUS;
    expect(assignTag("cs_abc", new Set())).toBe(tag);
    expect(assignTag("cs_abc", new Set([tag]))).toBe(next);
    expect(assignTag("cs_abc", new Set([tag, next]))).toBe((tag + 2) % TAG_MODULUS);
  });

  it("throws when every tag is taken", () => {
    const all = new Set(Array.from({ length: TAG_MODULUS }, (_, i) => i));
    expect(() => assignTag("cs_abc", all)).toThrow(/no free/);
  });
});

describe("saveWithUniqueTag (concurrency)", () => {
  const baseQuote = {
    asset: "ZEC" as const,
    amountBase: "1000000",
    decimals: 8 as const,
    rate: "40",
    source: "test",
    lockedAt: "2026-09-29T10:00:00.000Z",
    expiresAt: "2026-09-29T10:15:00.000Z",
  };

  /** A store whose reads and writes yield to the event loop, like a real DB. */
  function slowStore() {
    const saved = new Map<string, number>();
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
    return {
      saved,
      async taken(sessionId: string): Promise<Set<number>> {
        await tick();
        return new Set([...saved].filter(([id]) => id !== sessionId).map(([, tag]) => tag));
      },
      async save(sessionId: string, amountBase: string): Promise<string> {
        await tick();
        saved.set(sessionId, Number(BigInt(amountBase) - 1_000_000n));
        return sessionId;
      },
    };
  }

  // Two ids whose unbumped tags collide, so an unserialized read-pick-save race picks the same tag.
  function collidingIds(): [string, string] {
    const seen = new Map<number, string>();
    for (let i = 0; ; i += 1) {
      const id = `cs_${i}`;
      const tag = baseTag(id);
      const other = seen.get(tag);
      if (other !== undefined) return [other, id];
      seen.set(tag, id);
    }
  }

  it("gives concurrent sessions on one payTo distinct tags", async () => {
    const store = slowStore();
    const lock = createInMemoryTagLock();
    const ids = [...collidingIds(), "cs_a", "cs_b", "cs_c"];
    await Promise.all(
      ids.map((id) =>
        saveWithUniqueTag({
          lock,
          payTo: "t1pay",
          sessionId: id,
          baseQuote,
          takenTags: () => store.taken(id),
          save: (quote) => store.save(id, quote.amountBase),
        }),
      ),
    );
    const tags = [...store.saved.values()];
    expect(new Set(tags).size).toBe(ids.length);
  });

  it("moves to the next tag when the post-save re-check finds a collision", async () => {
    const store = slowStore();
    const [first, second] = collidingIds();
    store.saved.set(first, baseTag(first));
    let calls = 0;
    await saveWithUniqueTag({
      lock: createInMemoryTagLock(),
      payTo: "t1pay",
      sessionId: second,
      baseQuote,
      // First read misses the rival (a writer that bypassed the lock).
      takenTags: async () => (calls++ === 0 ? new Set<number>() : store.taken(second)),
      save: (quote) => store.save(second, quote.amountBase),
    });
    expect(store.saved.get(second)).not.toBe(store.saved.get(first));
  });
});
