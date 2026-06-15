import { describe, expect, it } from "vitest";
import { InMemoryEntitlementRepository } from "../src/index.js";
import { makeEntitlement } from "./fixtures.js";

describe("InMemoryEntitlementRepository", () => {
  it("saves and finds by id, storing immutable copies", async () => {
    const repo = new InMemoryEntitlementRepository();
    const ent = makeEntitlement();
    await repo.save(ent);

    const found = await repo.findById(ent.id);
    expect(found).toEqual(ent);
    expect(found).not.toBe(ent);

    // Mutating the returned copy must not affect stored state.
    if (found) found.status = "revoked";
    expect((await repo.findById(ent.id))?.status).toBe("active");
  });

  it("findActiveByCustomerProduct returns only active matches", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_active", customerId: "c1", productId: "p1", status: "active" }),
      makeEntitlement({ id: "ent_revoked", customerId: "c1", productId: "p1", status: "revoked" }),
    ]);

    const found = await repo.findActiveByCustomerProduct("c1", "p1");
    expect(found?.id).toBe("ent_active");

    expect(await repo.findActiveByCustomerProduct("c1", "p_other")).toBeNull();
  });

  it("listByCustomer filters and orders newest first", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_old", customerId: "c1", createdAt: "2026-01-01T00:00:00.000Z" }),
      makeEntitlement({ id: "ent_new", customerId: "c1", createdAt: "2026-03-01T00:00:00.000Z" }),
      makeEntitlement({ id: "ent_other", customerId: "c2" }),
    ]);

    const list = await repo.listByCustomer("c1");
    expect(list.map((e) => e.id)).toEqual(["ent_new", "ent_old"]);
  });

  it("listByCustomer can restrict to active and a product", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_a", customerId: "c1", productId: "p1", status: "active" }),
      makeEntitlement({ id: "ent_b", customerId: "c1", productId: "p1", status: "expired" }),
      makeEntitlement({ id: "ent_c", customerId: "c1", productId: "p2", status: "active" }),
    ]);

    const list = await repo.listByCustomer("c1", { activeOnly: true, productId: "p1" });
    expect(list.map((e) => e.id)).toEqual(["ent_a"]);
  });
});
