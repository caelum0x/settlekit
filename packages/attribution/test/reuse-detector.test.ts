import { describe, expect, it } from "vitest";
import { detectReuse, shingleSet, textFingerprint, tokenize } from "../src/reuse-detector.js";

const ARTICLE = `The Arc network settles USDC nanopayments gas-free using Gateway
  burn intents, so an agent can pay a fraction of a cent per citation and have it
  batched into a single on-chain settlement.`;

describe("tokenize / shingleSet", () => {
  it("lowercases and strips punctuation", () => {
    expect(tokenize("Hello, World!  Foo-bar")).toEqual(["hello", "world", "foo", "bar"]);
  });

  it("produces sliding k-word shingles", () => {
    const s = shingleSet("a b c d", 2);
    expect([...s].sort()).toEqual(["a b", "b c", "c d"]);
  });

  it("falls back to one shingle for text shorter than k", () => {
    expect([...shingleSet("two words", 4)]).toEqual(["two words"]);
  });

  it("returns an empty set for empty text", () => {
    expect(shingleSet("   ", 4).size).toBe(0);
  });
});

describe("textFingerprint", () => {
  it("is stable across whitespace and case differences", () => {
    expect(textFingerprint("Hello   World")).toBe(textFingerprint("hello world"));
  });
});

describe("detectReuse", () => {
  it("flags an answer copied from a source", () => {
    const answer = "an agent can pay a fraction of a cent per citation and have it batched";
    const report = detectReuse(answer, [
      { id: "src_arc", text: ARTICLE, wallet: "0xauthor" },
      { id: "src_other", text: "completely unrelated text about gardening tomatoes" },
    ]);
    expect(report.grounded).toBe(true);
    expect(report.matches[0]?.sourceId).toBe("src_arc");
    expect(report.matches[0]?.wallet).toBe("0xauthor");
    expect(report.matches[0]?.score).toBeGreaterThan(0.5);
    // the unrelated source should not clear the threshold
    expect(report.matches.some((m) => m.sourceId === "src_other")).toBe(false);
  });

  it("does not flag original text", () => {
    const report = detectReuse(
      "a wholly independent sentence sharing no phrases with the corpus whatsoever",
      [{ id: "src_arc", text: ARTICLE }],
    );
    expect(report.grounded).toBe(false);
    expect(report.matches).toEqual([]);
  });

  it("handles empty generated text", () => {
    const report = detectReuse("", [{ id: "src_arc", text: ARTICLE }]);
    expect(report.total).toBe(0);
    expect(report.grounded).toBe(false);
  });

  it("ranks the strongest grounding first", () => {
    const answer = "the arc network settles usdc nanopayments gas free using gateway burn intents";
    const report = detectReuse(answer, [
      { id: "weak", text: "the arc network is interesting" },
      { id: "strong", text: ARTICLE },
    ]);
    expect(report.matches[0]?.sourceId).toBe("strong");
  });
});
