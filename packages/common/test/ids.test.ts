import { describe, it, expect } from "vitest";
import { generateId, isId, generateSecret, uuid } from "../src/ids.js";

describe("ids", () => {
  it("generates prefixed ids that validate", () => {
    const id = generateId("product");
    expect(id.startsWith("prod_")).toBe(true);
    expect(isId("product", id)).toBe(true);
    expect(isId("customer", id)).toBe(false);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId("entitlement")));
    expect(ids.size).toBe(1000);
  });

  it("generates url-safe secrets of expected entropy", () => {
    const secret = generateSecret(32);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(43);
  });

  it("generates valid uuids", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
