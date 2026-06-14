import { describe, expect, it } from "vitest";
import { consumeRateLimit, rateLimitAllows } from "../src/index.js";

describe("rate limits", () => {
  it("allows and consumes quota", () => {
    const window = { key: "ak_1", limit: 10, used: 9, resetsAt: "2026-01-01T00:00:00.000Z" };
    expect(rateLimitAllows(window, 1, new Date("2025-12-31T00:00:00.000Z"))).toBe(true);
    expect(consumeRateLimit(window, 1).used).toBe(10);
  });
});
