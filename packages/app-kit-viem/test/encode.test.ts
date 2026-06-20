import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { encodeTransfer, toBaseUnits, checksumAddress } from "../src/index.js";

// A well-known checksummed test recipient (Anvil account #1). Not a secret.
const TO = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("encodeTransfer", () => {
  it("produces deterministic transfer(address,uint256) calldata", () => {
    // selector a9059cbb + 32-byte padded address + 32-byte padded uint256(1e6)
    const expected =
      "0xa9059cbb" +
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
      "00000000000000000000000000000000000000000000000000000000000f4240";
    expect(encodeTransfer(TO, 1_000_000n)).toBe(expected);
  });

  it("accepts a lowercase address and checksums it (same calldata)", () => {
    expect(encodeTransfer(TO.toLowerCase(), 1_000_000n)).toBe(
      encodeTransfer(TO, 1_000_000n),
    );
  });

  it("throws SettleKitError(validation_error) on a bad address", () => {
    try {
      encodeTransfer("0xnot-an-address", 1n);
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});

describe("toBaseUnits", () => {
  it("converts USDC (6 decimals) amounts to base units", () => {
    expect(toBaseUnits("1.00", 6)).toBe(1_000_000n);
    expect(toBaseUnits("0.000001", 6)).toBe(1n);
    expect(toBaseUnits("1234.567890", 6)).toBe(1_234_567_890n);
  });

  it("handles 18-decimal tokens", () => {
    expect(toBaseUnits("1.0", 18)).toBe(1_000_000_000_000_000_000n);
  });

  it("throws SettleKitError(validation_error) on a non-numeric amount", () => {
    try {
      toBaseUnits("not-a-number", 6);
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});

describe("checksumAddress", () => {
  it("checksums a valid address", () => {
    expect(checksumAddress(TO.toLowerCase())).toBe(TO);
  });

  it("rejects a non-0x value", () => {
    expect(() => checksumAddress("nope")).toThrow(SettleKitError);
  });
});
