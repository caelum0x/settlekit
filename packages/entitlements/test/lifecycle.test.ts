import { describe, expect, it } from "vitest";
import { expire, expireDue, isActive, revoke } from "../src/index.js";
import { makeEntitlement } from "./fixtures.js";

const NOW = new Date("2026-06-15T00:00:00.000Z");

describe("isActive", () => {
  it("is true for an active, non-expiring entitlement", () => {
    expect(isActive(makeEntitlement({ expiresAt: undefined }), NOW)).toBe(true);
  });

  it("is true for an active entitlement that expires in the future", () => {
    expect(isActive(makeEntitlement({ expiresAt: "2027-01-01T00:00:00.000Z" }), NOW)).toBe(true);
  });

  it("is false once the expiry has passed", () => {
    expect(isActive(makeEntitlement({ expiresAt: "2026-01-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("is false for revoked or expired status", () => {
    expect(isActive(makeEntitlement({ status: "revoked" }), NOW)).toBe(false);
    expect(isActive(makeEntitlement({ status: "expired" }), NOW)).toBe(false);
  });
});

describe("expireDue", () => {
  it("returns only active, past-due entitlements", () => {
    const live = makeEntitlement({ id: "ent_live", expiresAt: "2027-01-01T00:00:00.000Z" });
    const due = makeEntitlement({ id: "ent_due", expiresAt: "2026-01-01T00:00:00.000Z" });
    const noExpiry = makeEntitlement({ id: "ent_perm", expiresAt: undefined });
    const alreadyRevoked = makeEntitlement({ id: "ent_rev", status: "revoked", expiresAt: "2026-01-01T00:00:00.000Z" });

    const result = expireDue([live, due, noExpiry, alreadyRevoked], NOW);
    expect(result.map((e) => e.id)).toEqual(["ent_due"]);
  });
});

describe("expire", () => {
  it("transitions to expired immutably", () => {
    const ent = makeEntitlement();
    const after = expire(ent, NOW);
    expect(after.status).toBe("expired");
    expect(ent.status).toBe("active");
    expect(after.updatedAt).toBe(NOW.toISOString());
  });
});

describe("revoke", () => {
  it("transitions to revoked and records the reason", () => {
    const ent = makeEntitlement();
    const after = revoke(ent, "refunded", NOW);

    expect(after.status).toBe("revoked");
    expect(after.features?.__revokedReason).toBe("refunded");
    expect(ent.status).toBe("active");
    expect(after.updatedAt).toBe(NOW.toISOString());
  });
});
