import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  resolveChain,
  resolveDecimals,
  resolveUsdcAddress,
} from "../src/index.js";
import type { TokenAddressOverrides } from "../src/index.js";

const USDC_OVERRIDE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("resolveChain", () => {
  it("returns the verified Arc Testnet descriptor", () => {
    const arc = resolveChain("Arc_Testnet");
    expect(arc.key).toBe("Arc_Testnet");
    expect(arc.rpcUrl).toBe("https://rpc.testnet.arc.network/");
  });

  it("throws SettleKitError on an unknown chain key", () => {
    try {
      resolveChain("Solana_Devnet");
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});

describe("resolveUsdcAddress", () => {
  it("throws a clear 'not configured' error when arc-chains has no address", () => {
    try {
      resolveUsdcAddress("Arc_Testnet");
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      const err = e as SettleKitError;
      expect(err.code).toBe("validation_error");
      expect(err.message).toContain("not configured");
      expect(err.message).toContain("Arc_Testnet");
    }
  });

  it("returns the checksummed override address when injected", () => {
    const overrides: TokenAddressOverrides = {
      Arc_Testnet: { USDC: USDC_OVERRIDE.toLowerCase() },
    };
    expect(resolveUsdcAddress("Arc_Testnet", "USDC", overrides)).toBe(
      USDC_OVERRIDE,
    );
  });

  it("rejects a non-0x override", () => {
    const overrides: TokenAddressOverrides = {
      Arc_Testnet: { USDC: "not-an-address" },
    };
    expect(() => resolveUsdcAddress("Arc_Testnet", "USDC", overrides)).toThrow(
      SettleKitError,
    );
  });
});

describe("resolveDecimals", () => {
  it("returns 6 for USDC", () => {
    expect(resolveDecimals("USDC")).toBe(6);
    expect(resolveDecimals()).toBe(6);
  });

  it("returns 18 for DAI", () => {
    expect(resolveDecimals("DAI")).toBe(18);
  });
});
