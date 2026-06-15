import { describe, expect, it } from "vitest";
import { importRows, parseCsvLines } from "../src/index.js";

describe("imports", () => {
  it("parses CSV rows", () => {
    expect(parseCsvLines("id,email\n1,a@example.com")).toEqual([["id", "email"], ["1", "a@example.com"]]);
    expect(importRows("id\n1", (_headers, cells) => ({ id: cells[0] })).rows).toEqual([{ id: "1" }]);
  });
});
