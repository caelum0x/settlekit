import { describe, expect, it } from "vitest";
import { decodeAbiParameters, keccak256, toHex } from "viem";
import { encodeSettleKitHookData, toOrderId } from "../src/encode.js";

const MERCHANT = "0x1111111111111111111111111111111111111111";

describe("toOrderId", () => {
  it("passes a 0x 32-byte hash through unchanged", () => {
    const h = keccak256(toHex("x"));
    expect(toOrderId(h)).toBe(h);
  });
  it("hashes an arbitrary string to bytes32", () => {
    expect(toOrderId("checkout_1")).toBe(keccak256(toHex("checkout_1")));
  });
});

describe("encodeSettleKitHookData", () => {
  it("round-trips through abi.decode(address,bytes32) — matches the hook contract", () => {
    const orderId = "checkout_42";
    const hookData = encodeSettleKitHookData({ merchant: MERCHANT, orderId });
    const [merchant, decodedOrder] = decodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      hookData,
    );
    expect((merchant as string).toLowerCase()).toBe(MERCHANT);
    expect(decodedOrder).toBe(keccak256(toHex(orderId)));
  });

  it("rejects a non-address merchant", () => {
    expect(() => encodeSettleKitHookData({ merchant: "0xnope" as `0x${string}`, orderId: "x" })).toThrow(
      /invalid merchant/,
    );
  });
});
