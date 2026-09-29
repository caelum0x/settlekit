import { describe, expect, it } from "vitest";
import { assignTag, baseTag, buildZip321Uri, formatZecAmount, TAG_MODULUS } from "../src/index.js";

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
