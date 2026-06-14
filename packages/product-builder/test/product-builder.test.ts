import { describe, expect, it } from "vitest";
import { addDeliveryMode, defaultActionsForDeliveryModes, selectChargeMode, selectProductType } from "../src/index.js";

describe("product builder", () => {
  it("builds wizard state and default actions", () => {
    const state = addDeliveryMode(selectChargeMode(selectProductType({ deliveryModes: [] }, "api_access"), "monthly"), "api_key");
    expect(state.productType).toBe("api_access");
    expect(defaultActionsForDeliveryModes(state.deliveryModes)).toEqual([{ type: "api_key_create", scopes: ["api:read"] }]);
  });
});
