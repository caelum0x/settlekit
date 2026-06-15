import { describe, expect, it } from "vitest";
import { retentionExpiresAt, shouldPurge } from "../src/index.js";

describe("data retention", () => {
  it("calculates purge windows", () => {
    const policy = { resourceType: "webhook_event", retainDays: 30 };
    expect(retentionExpiresAt("2026-01-01T00:00:00.000Z", policy)).toBe("2026-01-31T00:00:00.000Z");
    expect(shouldPurge("2026-01-01T00:00:00.000Z", policy, new Date("2026-02-01T00:00:00.000Z"))).toBe(true);
  });
});
