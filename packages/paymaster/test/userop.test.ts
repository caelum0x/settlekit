import { describe, expect, it } from "vitest";
import { ARC_TESTNET } from "@settlekit/arc";
import { SettleKitError } from "@settlekit/common";
import {
  CIRCLE_PAYMASTER_ADDRESS,
  DEFAULT_MAX_GAS_USDC,
  ENTRYPOINT_ADDRESS,
  MAX_UINT256,
  assembleUserOperation,
  buildPermitTypedData,
  encodePaymasterData,
  getUserOperationHashV07,
  resolvePaymasterAddress,
  withPaymaster,
} from "../src/index.js";
import type { UserOperation } from "../src/index.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const USDC = ARC_TESTNET.tokens.USDC.address;

function baseUserOp(): UserOperation {
  return assembleUserOperation({
    sender: OWNER,
    nonce: 0n,
    callData: "0xdeadbeef",
    gas: {
      callGasLimit: 100_000n,
      verificationGasLimit: 200_000n,
      preVerificationGas: 50_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    },
  });
}

describe("resolvePaymasterAddress", () => {
  it("resolves the published Arc testnet v0.7 paymaster", () => {
    expect(resolvePaymasterAddress(ARC_TESTNET, "0.7")).toBe(
      CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"],
    );
  });

  it("resolves the published Arc testnet v0.8 paymaster", () => {
    expect(resolvePaymasterAddress(ARC_TESTNET, "0.8")).toBe(
      CIRCLE_PAYMASTER_ADDRESS.testnet["0.8"],
    );
  });

  it("honors an explicit override", () => {
    const custom = "0x9999999999999999999999999999999999999999" as const;
    expect(resolvePaymasterAddress(ARC_TESTNET, "0.7", custom)).toBe(custom);
  });

  it("throws for an unpublished mainnet address without override", () => {
    const arcMainnet = { ...ARC_TESTNET, network: "mainnet" as const };
    expect(() => resolvePaymasterAddress(arcMainnet, "0.7")).toThrow(SettleKitError);
  });
});

describe("buildPermitTypedData", () => {
  it("builds EIP-2612 typed data with the correct domain and message", () => {
    const td = buildPermitTypedData({
      tokenName: "USDC",
      tokenVersion: "2",
      usdcAddress: USDC,
      chainId: ARC_TESTNET.chainId,
      owner: OWNER,
      spender: CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"],
      value: DEFAULT_MAX_GAS_USDC,
      nonce: 7n,
    });
    expect(td.primaryType).toBe("Permit");
    expect(td.domain).toEqual({
      name: "USDC",
      version: "2",
      chainId: ARC_TESTNET.chainId,
      verifyingContract: USDC,
    });
    expect(td.message).toEqual({
      owner: OWNER,
      spender: CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"],
      value: DEFAULT_MAX_GAS_USDC,
      nonce: 7n,
      deadline: MAX_UINT256,
    });
    expect(td.types.Permit.map((f) => f.name)).toEqual([
      "owner",
      "spender",
      "value",
      "nonce",
      "deadline",
    ]);
  });

  it("rejects a non-positive value", () => {
    expect(() =>
      buildPermitTypedData({
        tokenName: "USDC",
        tokenVersion: "2",
        usdcAddress: USDC,
        chainId: ARC_TESTNET.chainId,
        owner: OWNER,
        spender: USDC,
        value: 0n,
        nonce: 0n,
      }),
    ).toThrow(SettleKitError);
  });
});

describe("encodePaymasterData", () => {
  it("packs uint8(0) ‖ token ‖ uint256(maxGas) ‖ signature", () => {
    const sig = `0x${"ab".repeat(65)}` as const;
    const data = encodePaymasterData({
      usdcAddress: USDC,
      maxGasUsdc: 1_000_000n,
      permitSignature: sig,
    });
    // 1 (uint8) + 20 (address) + 32 (uint256) + 65 (sig) = 118 bytes => 236 hex + 0x
    expect(data.length).toBe(2 + 118 * 2);
    expect(data.startsWith("0x00")).toBe(true);
    // token address (lowercased) appears right after the reserved byte
    expect(data.slice(4, 4 + 40).toLowerCase()).toBe(USDC.slice(2).toLowerCase());
    // 1_000_000 = 0xf4240, padded to 32 bytes
    expect(data.toLowerCase()).toContain("00000000000000000000000000000f4240");
    expect(data.toLowerCase().endsWith("ab".repeat(65))).toBe(true);
  });

  it("rejects a non-positive maxGasUsdc", () => {
    expect(() =>
      encodePaymasterData({ usdcAddress: USDC, maxGasUsdc: 0n, permitSignature: "0x" }),
    ).toThrow(SettleKitError);
  });
});

describe("withPaymaster", () => {
  it("returns a new UserOp without mutating the input", () => {
    const op = baseUserOp();
    const next = withPaymaster(op, {
      paymaster: CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"],
      paymasterData: "0xabcd",
      paymasterVerificationGasLimit: 60_000n,
      paymasterPostOpGasLimit: 40_000n,
    });
    expect(op.paymaster).toBeUndefined();
    expect(next).not.toBe(op);
    expect(next.paymaster).toBe(CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"]);
    expect(next.paymasterData).toBe("0xabcd");
    expect(next.paymasterVerificationGasLimit).toBe(60_000n);
    expect(next.paymasterPostOpGasLimit).toBe(40_000n);
  });
});

describe("getUserOperationHashV07", () => {
  it("is a deterministic 32-byte hash", () => {
    const op = baseUserOp();
    const h = getUserOperationHashV07(op, ENTRYPOINT_ADDRESS["0.7"], ARC_TESTNET.chainId);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    const again = getUserOperationHashV07(op, ENTRYPOINT_ADDRESS["0.7"], ARC_TESTNET.chainId);
    expect(again).toBe(h);
  });

  it("changes when paymaster fields change", () => {
    const op = baseUserOp();
    const sponsored = withPaymaster(op, {
      paymaster: CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"],
      paymasterData: "0xabcd",
      paymasterVerificationGasLimit: 60_000n,
      paymasterPostOpGasLimit: 40_000n,
    });
    const h1 = getUserOperationHashV07(op, ENTRYPOINT_ADDRESS["0.7"], ARC_TESTNET.chainId);
    const h2 = getUserOperationHashV07(
      sponsored,
      ENTRYPOINT_ADDRESS["0.7"],
      ARC_TESTNET.chainId,
    );
    expect(h2).not.toBe(h1);
  });

  it("changes with chainId", () => {
    const op = baseUserOp();
    const h1 = getUserOperationHashV07(op, ENTRYPOINT_ADDRESS["0.7"], ARC_TESTNET.chainId);
    const h2 = getUserOperationHashV07(op, ENTRYPOINT_ADDRESS["0.7"], 999);
    expect(h2).not.toBe(h1);
  });
});

describe("ENTRYPOINT_ADDRESS", () => {
  it("exposes the canonical v0.7 and v0.8 singletons", () => {
    expect(ENTRYPOINT_ADDRESS["0.7"]).toBe(
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    );
    expect(ENTRYPOINT_ADDRESS["0.8"]).toBe(
      "0x4337084D9E255Ff0702461CF8895cE9E3b5Ff108",
    );
  });
});
