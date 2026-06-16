import { describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toHex } from "viem";
import {
  buildCreateAndFundTx,
  buildReleaseTx,
  escrowId,
} from "../src/escrow.js";
import { SETTLEKIT_ESCROW_ABI } from "../src/abi.js";

const ESCROW = "0xeeee000000000000000000000000000000000000";
const SELLER = "0x5e11000000000000000000000000000000000000";
const ARBITER = "0xa121000000000000000000000000000000000000";

describe("escrowId", () => {
  it("hashes a string and passes a 0x hash through", () => {
    expect(escrowId("order-1")).toBe(keccak256(toHex("order-1")));
    const h = keccak256(toHex("y"));
    expect(escrowId(h)).toBe(h);
  });
});

describe("buildCreateAndFundTx", () => {
  it("encodes createAndFund with value 0 and decodes back", () => {
    const req = buildCreateAndFundTx(ESCROW, { id: "order-1", seller: SELLER, arbiter: ARBITER, amount: 100_000000n });
    expect(req.to.toLowerCase()).toBe(ESCROW);
    expect(req.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: SETTLEKIT_ESCROW_ABI, data: req.data });
    expect(decoded.functionName).toBe("createAndFund");
    expect(decoded.args[0]).toBe(escrowId("order-1"));
    expect((decoded.args[3] as bigint)).toBe(100_000000n);
  });

  it("rejects a bad address", () => {
    expect(() => buildCreateAndFundTx(ESCROW, { id: "x", seller: "0xnope", arbiter: ARBITER, amount: 1n })).toThrow(
      /address/,
    );
  });
});

describe("buildReleaseTx", () => {
  it("encodes release(id)", () => {
    const req = buildReleaseTx(ESCROW, "order-1");
    const decoded = decodeFunctionData({ abi: SETTLEKIT_ESCROW_ABI, data: req.data });
    expect(decoded.functionName).toBe("release");
    expect(decoded.args[0]).toBe(escrowId("order-1"));
  });
});
