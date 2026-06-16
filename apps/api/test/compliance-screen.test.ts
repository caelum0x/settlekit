import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import type { ScreeningClient, AddressScreening } from "@settlekit/compliance";
import { circleChainForNetwork, screenAddressOrThrow } from "../src/compliance/screen.js";

function screeningReturning(result: "APPROVED" | "DENIED", riskSignals: AddressScreening["riskSignals"] = []): ScreeningClient {
  return {
    async screenAddress(input) {
      return { address: input.address, chain: input.chain, result, riskSignals, raw: {} };
    },
  };
}

describe("circleChainForNetwork", () => {
  it("maps known networks and falls back for Arc", () => {
    expect(circleChainForNetwork("base", "ETH")).toBe("BASE");
    expect(circleChainForNetwork("ethereum", "ETH")).toBe("ETH");
    expect(circleChainForNetwork("arc", "ETH")).toBe("ETH");
    expect(circleChainForNetwork("arc", "MATIC")).toBe("MATIC");
  });
});

describe("screenAddressOrThrow", () => {
  const target = { address: "0xabc", network: "arc", context: "payout:po_1" };

  it("is a no-op (allow) when screening is unconfigured", async () => {
    const decision = await screenAddressOrThrow({ screening: null, defaultChain: "ETH" }, target);
    expect(decision).toBe("allow");
  });

  it("allows a clean (APPROVED, no signals) address", async () => {
    const decision = await screenAddressOrThrow(
      { screening: screeningReturning("APPROVED"), defaultChain: "ETH" },
      target,
    );
    expect(decision).toBe("allow");
  });

  it("throws compliance_blocked on a DENIED result", async () => {
    await expect(
      screenAddressOrThrow({ screening: screeningReturning("DENIED"), defaultChain: "ETH" }, target),
    ).rejects.toMatchObject({ code: "compliance_blocked", httpStatus: 403 });
  });

  it("throws compliance_blocked on a SANCTIONS category", async () => {
    const screening = screeningReturning("APPROVED", [{ riskCategories: ["SANCTIONS"] }]);
    await expect(
      screenAddressOrThrow({ screening, defaultChain: "ETH" }, target),
    ).rejects.toBeInstanceOf(SettleKitError);
  });

  it("allows but reports review on a medium-risk signal", async () => {
    const screening = screeningReturning("APPROVED", [{ riskScore: "MEDIUM" }]);
    const decision = await screenAddressOrThrow({ screening, defaultChain: "ETH" }, target);
    expect(decision).toBe("review");
  });
});
