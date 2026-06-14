import { describe, expect, it } from "vitest";
import { searchDocuments, tagFacets } from "../src/index.js";

describe("search", () => {
  it("searches published documents and counts facets", () => {
    const docs = [{ id: "1", title: "Research API", summary: "x402 paid API", tags: ["api"], published: true }];
    expect(searchDocuments(docs, "paid api")).toHaveLength(1);
    expect(tagFacets(docs).api).toBe(1);
  });
});
