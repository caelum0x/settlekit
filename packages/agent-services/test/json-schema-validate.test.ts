import { describe, expect, it } from "vitest";
import { isErr, isOk } from "@settlekit/common";
import {
  validateInputAgainstSchema,
  validateValueAgainstSchema,
  asJsonSchema,
  type JsonSchema,
} from "../src/index.js";

const objectSchema: JsonSchema = {
  type: "object",
  required: ["query", "limit"],
  additionalProperties: false,
  properties: {
    query: { type: "string" },
    limit: { type: "integer" },
    tags: { type: "array", items: { type: "string" } },
    mode: { type: "string", enum: ["fast", "thorough"] },
  },
};

describe("validateValueAgainstSchema", () => {
  it("accepts a conforming object", () => {
    const violations = validateValueAgainstSchema(
      { query: "hello", limit: 10, tags: ["a", "b"], mode: "fast" },
      objectSchema,
    );
    expect(violations).toEqual([]);
  });

  it("reports missing required properties", () => {
    const violations = validateValueAgainstSchema({ query: "hi" }, objectSchema);
    expect(violations.map((v) => v.path)).toContain("/limit");
  });

  it("reports type mismatches with a path", () => {
    const violations = validateValueAgainstSchema({ query: 1, limit: "x" }, objectSchema);
    const paths = violations.map((v) => v.path);
    expect(paths).toContain("/query");
    expect(paths).toContain("/limit");
  });

  it("rejects additional properties when disallowed", () => {
    const violations = validateValueAgainstSchema(
      { query: "x", limit: 1, extra: true },
      objectSchema,
    );
    expect(violations.some((v) => v.path === "/extra")).toBe(true);
  });

  it("validates array items", () => {
    const violations = validateValueAgainstSchema(
      { query: "x", limit: 1, tags: ["ok", 2] },
      objectSchema,
    );
    expect(violations.some((v) => v.path === "/tags/1")).toBe(true);
  });

  it("enforces enum membership", () => {
    const violations = validateValueAgainstSchema(
      { query: "x", limit: 1, mode: "nope" },
      objectSchema,
    );
    expect(violations.some((v) => v.path === "/mode")).toBe(true);
  });

  it("treats integers as valid numbers", () => {
    const violations = validateValueAgainstSchema(5, { type: "number" });
    expect(violations).toEqual([]);
  });
});

describe("validateInputAgainstSchema", () => {
  it("returns ok for valid input", () => {
    const result = validateInputAgainstSchema(
      { query: "x", limit: 1 },
      asJsonSchema(objectSchema) as Record<string, unknown>,
    );
    expect(isOk(result)).toBe(true);
  });

  it("returns a validation_error carrying violations", () => {
    const result = validateInputAgainstSchema(
      { query: 1 },
      objectSchema as Record<string, unknown>,
    );
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("validation_error");
      expect(Array.isArray((result.error.details as { violations: unknown[] }).violations)).toBe(
        true,
      );
    }
  });
});
