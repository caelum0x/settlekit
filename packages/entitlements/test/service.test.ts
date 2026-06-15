import { SettleKitError } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { EntitlementService, InMemoryEntitlementRepository } from "../src/index.js";
import { makeEntitlement, makePayment, makeProduct } from "./fixtures.js";

function freshService() {
  const repo = new InMemoryEntitlementRepository();
  return { repo, service: new EntitlementService(repo) };
}

describe("EntitlementService.verify (SDK-style end to end)", () => {
  it("grants from payment then verifies the feature for the customer", async () => {
    const { service } = freshService();
    await service.grantFromPayment({
      payment: makePayment({ customerId: "user_1" }),
      product: makeProduct(),
      deliveryAction: { type: "saas_entitlement_create", features: { ai_export: true, max_projects: 10 } },
    });

    const result = await service.verify({ customerId: "user_1", feature: "ai_export" });
    expect(result.allowed).toBe(true);
    expect(result.value).toBe(true);
    expect(result.entitlement?.customerId).toBe("user_1");
  });

  it("denies a feature the customer does not have", async () => {
    const { service } = freshService();
    await service.grantFromPayment({
      payment: makePayment({ customerId: "user_1" }),
      product: makeProduct(),
      deliveryAction: { type: "saas_entitlement_create", features: { ai_export: true } },
    });

    const result = await service.verify({ customerId: "user_1", feature: "premium_support" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("feature_not_granted");
  });

  it("returns no_active_entitlement when the customer is unknown", async () => {
    const { service } = freshService();
    const result = await service.verify({ customerId: "ghost", feature: "ai_export" });
    expect(result).toMatchObject({ allowed: false, reason: "no_active_entitlement" });
  });

  it("scans across multiple entitlements to satisfy a feature", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_a", customerId: "user_1", productId: "prod_a", features: { basic: true } }),
      makeEntitlement({ id: "ent_b", customerId: "user_1", productId: "prod_b", features: { ai_export: true } }),
    ]);
    const service = new EntitlementService(repo);

    const result = await service.verify({ customerId: "user_1", feature: "ai_export" });
    expect(result.allowed).toBe(true);
    expect(result.entitlement?.id).toBe("ent_b");
  });

  it("verifies against a specific product when productId is supplied", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_a", customerId: "user_1", productId: "prod_a", creditsRemaining: 2 }),
    ]);
    const service = new EntitlementService(repo);

    const ok = await service.verify({ customerId: "user_1", productId: "prod_a", requiredCredits: 2 });
    expect(ok.allowed).toBe(true);

    const short = await service.verify({ customerId: "user_1", productId: "prod_a", requiredCredits: 5 });
    expect(short).toMatchObject({ allowed: false, reason: "insufficient_credits" });
  });

  it("ignores expired entitlements during verification", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_old", customerId: "user_1", expiresAt: "2020-01-01T00:00:00.000Z" }),
    ]);
    const service = new EntitlementService(repo);

    const result = await service.verify({ customerId: "user_1", feature: "ai_export", now: new Date("2026-06-15") });
    expect(result).toMatchObject({ allowed: false, reason: "no_active_entitlement" });
  });
});

describe("EntitlementService.spendCredits", () => {
  it("deducts and persists the new balance", async () => {
    const { repo, service } = freshService();
    const granted = await service.grantFromPayment({
      payment: makePayment({ customerId: "user_1" }),
      product: makeProduct({ id: "prod_credits", type: "paid_api_call" }),
      creditsRemaining: 10,
    });

    const after = await service.spendCredits("user_1", "prod_credits", 4);
    expect(after.creditsRemaining).toBe(6);

    const persisted = await repo.findById(granted.id);
    expect(persisted?.creditsRemaining).toBe(6);
  });

  it("throws insufficient_credits when short", async () => {
    const { service } = freshService();
    await service.grantFromPayment({
      payment: makePayment({ customerId: "user_1" }),
      product: makeProduct({ id: "prod_credits", type: "paid_api_call" }),
      creditsRemaining: 1,
    });

    await expect(service.spendCredits("user_1", "prod_credits", 5)).rejects.toMatchObject({
      code: "insufficient_credits",
    });
  });

  it("throws not_found when there is no active entitlement", async () => {
    const { service } = freshService();
    await expect(service.spendCredits("ghost", "prod_x", 1)).rejects.toBeInstanceOf(SettleKitError);
  });
});

describe("EntitlementService.revoke and expiry sweep", () => {
  it("revokes an entitlement so verification fails afterwards", async () => {
    const { service } = freshService();
    const granted = await service.grantFromPayment({
      payment: makePayment({ customerId: "user_1" }),
      product: makeProduct(),
      deliveryAction: { type: "saas_entitlement_create", features: { ai_export: true } },
    });

    await service.revoke(granted.id, "chargeback");

    const result = await service.verify({ customerId: "user_1", feature: "ai_export" });
    expect(result.allowed).toBe(false);
  });

  it("expires past-due entitlements during a sweep", async () => {
    const repo = new InMemoryEntitlementRepository([
      makeEntitlement({ id: "ent_due", customerId: "user_1", expiresAt: "2020-01-01T00:00:00.000Z" }),
      makeEntitlement({ id: "ent_live", customerId: "user_1", expiresAt: "2099-01-01T00:00:00.000Z" }),
    ]);
    const service = new EntitlementService(repo);

    const expired = await service.expireDueForCustomer("user_1", new Date("2026-06-15"));
    expect(expired.map((e) => e.id)).toEqual(["ent_due"]);
    expect((await repo.findById("ent_due"))?.status).toBe("expired");
    expect((await repo.findById("ent_live"))?.status).toBe("active");
  });
});
