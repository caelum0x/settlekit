import { describe, expect, it } from "vitest";
import { decideCompliance, kybComplete } from "../src/index.js";

describe("compliance", () => {
  it("blocks high-risk signals and checks KYB fields", () => {
    expect(decideCompliance([{ type: "sanctions_match", severity: "high" }])).toBe("block");
    expect(kybComplete({ legalName: "Acme", country: "US", taxId: "12" })).toBe(true);
  });
});
