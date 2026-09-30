import { describe, expect, it } from "vitest";
import { isPlatformKey, requiredScope, scopesAllow, scopesForRole } from "../src/index.js";

describe("management scope policy", () => {
  it("maps routes to resource scopes", () => {
    expect(requiredScope("GET", "/v1/payments")).toBe("payments:read");
    expect(requiredScope("POST", "/v1/refunds")).toBe("payments:write");
    expect(requiredScope("POST", "/v1/checkout-sessions")).toBe("checkout:write");
    expect(requiredScope("GET", "/v1/exports/xero.csv")).toBe("reports:read");
    expect(requiredScope("POST", "/v1/merchant/profile")).toBe("settings:write");
    expect(requiredScope("POST", "/v1/merchant/products")).toBe("products:write");
    // Refund to payer (confirm / cancel) is a payments action, like the refund itself.
    expect(requiredScope("POST", "/v1/merchant/refunds/ref_1/confirm")).toBe("payments:write");
    expect(requiredScope("POST", "/v1/merchant/payments/pay_1/refund/prepare")).toBe("payments:write");
    expect(requiredScope("POST", "/v1/entitlements/verify")).toBe("access:read");
    expect(requiredScope("POST", "/v1/api-keys/verify")).toBe("access:read");
    expect(requiredScope("POST", "/v1/api-keys")).toBe("api_keys:write");
    expect(requiredScope("POST", "/v1/gas-station/policies")).toBe("treasury:write");
    expect(requiredScope("GET", "/v1/unknown-thing")).toBe("platform:admin");
  });

  it("lets write imply read and wildcards imply everything", () => {
    expect(scopesAllow(["payments:write"], "payments:read")).toBe(true);
    expect(scopesAllow(["payments:read"], "payments:write")).toBe(false);
    expect(scopesAllow(["*"], "team:write")).toBe(true);
    expect(scopesAllow(["platform:admin"], "platform:admin")).toBe(true);
    expect(scopesAllow(["products:write"], "platform:admin")).toBe(false);
  });

  it("never treats a buyer access key as a platform key", () => {
    const P = "__platform__";
    expect(isPlatformKey({ scopes: ["read"], status: "active", productId: "prod_1" })).toBe(false);
    // A seller configuring management-looking scopes on a product key does not make it a platform key.
    expect(isPlatformKey({ scopes: ["*"], status: "active", productId: "prod_1" })).toBe(false);
    expect(isPlatformKey({ scopes: ["read"], status: "active", productId: P })).toBe(false);
    expect(isPlatformKey({ scopes: ["platform:admin"], status: "active", productId: P })).toBe(true);
    expect(isPlatformKey({ scopes: ["payments:read"], status: "active", productId: P })).toBe(true);
    expect(isPlatformKey({ scopes: ["*"], status: "revoked", productId: P })).toBe(false);
  });

  it("gives each role a sensible scope set", () => {
    expect(scopesForRole("owner")).toEqual(["*"]);
    const dev = scopesForRole("developer");
    expect(scopesAllow(dev, "webhooks:write")).toBe(true);
    expect(scopesAllow(dev, "settings:write")).toBe(false);
    expect(scopesAllow(dev, "team:write")).toBe(false);
    const viewer = scopesForRole("viewer");
    expect(scopesAllow(viewer, "payments:read")).toBe(true);
    expect(scopesAllow(viewer, "payments:write")).toBe(false);
    expect(scopesAllow(viewer, "api_keys:read")).toBe(false);
    const support = scopesForRole("support");
    expect(scopesAllow(support, "payments:write")).toBe(true);
    expect(scopesAllow(support, "settings:read")).toBe(false);
  });
});
