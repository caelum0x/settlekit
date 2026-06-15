import { describe, expect, it } from "vitest";
import { createIncident, overallStatus } from "../src/index.js";

describe("status page", () => {
  it("rolls up component health", () => {
    expect(overallStatus([{ name: "Arc", status: "operational" }, { name: "Delivery", status: "degraded" }])).toBe("degraded");
    expect(createIncident("Webhook delay").status).toBe("investigating");
  });
});
