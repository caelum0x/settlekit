import type { DeliveryAction } from "@settlekit/common";
import { describe, expect, it } from "vitest";
import { grantFromPayment, grantFromSubscription, resolveEntitlementType } from "../src/index.js";
import { makePayment, makeProduct, makeSubscription } from "./fixtures.js";

describe("grantFromPayment", () => {
  it("derives entitlement type from the delivery action", () => {
    const action: DeliveryAction = { type: "github_invite", repoId: "repo_42", permission: "pull" };
    const ent = grantFromPayment({
      payment: makePayment(),
      product: makeProduct({ type: "github_repo_access", deliveryMode: "github_invite" }),
      deliveryAction: action,
    });

    expect(ent.entitlementType).toBe("github_repo_access");
    expect(ent.resourceId).toBe("repo_42");
    expect(ent.status).toBe("active");
    expect(ent.grantedBy).toEqual({ type: "payment", id: "pay_test_1" });
    expect(ent.id.startsWith("ent_")).toBe(true);
  });

  it("creates a saas feature entitlement from saas_entitlement_create", () => {
    const action: DeliveryAction = {
      type: "saas_entitlement_create",
      features: { ai_export: true, max_projects: 10 },
    };
    const ent = grantFromPayment({ payment: makePayment(), product: makeProduct(), deliveryAction: action });

    expect(ent.entitlementType).toBe("saas_feature");
    expect(ent.features).toEqual({ ai_export: true, max_projects: 10 });
  });

  it("turns api key scopes into feature flags", () => {
    const action: DeliveryAction = { type: "api_key_create", scopes: ["read", "write"] };
    const ent = grantFromPayment({ payment: makePayment(), product: makeProduct({ type: "api_access" }), deliveryAction: action });

    expect(ent.entitlementType).toBe("api_access");
    expect(ent.features).toEqual({ read: true, write: true });
  });

  it("falls back to product type when no delivery action is given", () => {
    const ent = grantFromPayment({
      payment: makePayment(),
      product: makeProduct({ type: "paid_api_call" }),
      creditsRemaining: 1000,
    });

    expect(ent.entitlementType).toBe("api_credits");
    expect(ent.creditsRemaining).toBe(1000);
  });

  it("merges explicit features over action-derived features", () => {
    const action: DeliveryAction = { type: "saas_entitlement_create", features: { ai_export: false } };
    const ent = grantFromPayment({
      payment: makePayment(),
      product: makeProduct(),
      deliveryAction: action,
      features: { ai_export: true, beta: true },
    });

    expect(ent.features).toEqual({ ai_export: true, beta: true });
  });

  it("honours an explicit expiry", () => {
    const ent = grantFromPayment({
      payment: makePayment(),
      product: makeProduct(),
      expiresAt: "2026-12-31T00:00:00.000Z",
    });
    expect(ent.expiresAt).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("grantFromSubscription", () => {
  it("defaults expiry to the current period end", () => {
    const ent = grantFromSubscription({
      subscription: makeSubscription(),
      product: makeProduct(),
      features: { ai_export: true },
    });

    expect(ent.grantedBy).toEqual({ type: "subscription", id: "sub_test_1" });
    expect(ent.expiresAt).toBe("2026-02-01T00:00:00.000Z");
    expect(ent.status).toBe("active");
  });
});

describe("resolveEntitlementType", () => {
  it("prefers the delivery action over the product type", () => {
    const t = resolveEntitlementType(makeProduct({ type: "saas_plan" }), {
      type: "discord_role_add",
      guildId: "g1",
      roleId: "r1",
    });
    expect(t).toBe("discord_role");
  });
});
