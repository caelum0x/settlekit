import { describe, expect, it } from "vitest";
import { assignSeat, seatsAvailable, type TenantEntitlements } from "../src/index.js";

const entitlements: TenantEntitlements = {
  customerId: "cus_1",
  planId: "plan_pro",
  features: {},
  seatsIncluded: 1,
  seatsAssigned: [],
  usageLimits: {},
};

describe("seat limits", () => {
  it("assigns seats until the plan limit", () => {
    const assigned = assignSeat(entitlements, "user_1");
    expect(seatsAvailable(assigned)).toBe(0);
    expect(() => assignSeat(assigned, "user_2")).toThrow(/seat limit/);
  });
});
