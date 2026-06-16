import { describe, expect, it } from "vitest";
import { ARC_TESTNET } from "@settlekit/arc";
import { SettleKitError } from "@settlekit/common";
import { createPaymasterClient } from "../src/index.js";
import type {
  BundlerGasEstimator,
  PermitSigner,
  PermitTypedData,
  TokenPermitReader,
  UserOperation,
} from "../src/index.js";
import { CIRCLE_PAYMASTER_ADDRESS, assembleUserOperation } from "../src/index.js";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const USDC = ARC_TESTNET.tokens.USDC.address;
const SIG_65 = `0x${"cd".repeat(65)}` as const;

/** In-memory token reader returning canned metadata + nonce. */
function fakeReader(opts?: { nonce?: bigint }): TokenPermitReader & { seen: PermitTypedData[] } {
  return {
    seen: [],
    async tokenName() {
      return "USDC";
    },
    async tokenVersion() {
      return "2";
    },
    async permitNonce() {
      return opts?.nonce ?? 3n;
    },
  };
}

/** Signer that records the typed data it was asked to sign. */
function recordingSigner(signature = SIG_65): PermitSigner & { signed: PermitTypedData[] } {
  const signed: PermitTypedData[] = [];
  return {
    signed,
    async signTypedData(td) {
      signed.push(td);
      return signature;
    },
  };
}

function userOp(): UserOperation {
  return assembleUserOperation({ sender: OWNER, nonce: 0n, callData: "0x" });
}

describe("createPaymasterClient.sponsorWithUsdc", () => {
  it("builds, signs the permit, and attaches paymaster + paymasterData", async () => {
    const reader = fakeReader({ nonce: 9n });
    const signer = recordingSigner();
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      reader,
      signer,
    });

    const result = await client.sponsorWithUsdc({ userOp: userOp(), maxGasUsdc: 2_000_000n });

    expect(result.paymaster).toBe(CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"]);
    expect(result.usdcAddress).toBe(USDC);
    expect(result.maxGasUsdc).toBe(2_000_000n);

    // permit signed once, with the right spender + nonce + value
    expect(signer.signed).toHaveLength(1);
    const td = signer.signed[0]!;
    expect(td.message.spender).toBe(CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"]);
    expect(td.message.owner).toBe(OWNER);
    expect(td.message.nonce).toBe(9n);
    expect(td.message.value).toBe(2_000_000n);

    // paymasterData ends with the 65-byte signature, no gas limits without estimator
    expect(result.userOp.paymaster).toBe(CIRCLE_PAYMASTER_ADDRESS.testnet["0.7"]);
    expect(result.userOp.paymasterData?.toLowerCase().endsWith("cd".repeat(65))).toBe(true);
    expect(result.userOp.paymasterVerificationGasLimit).toBeUndefined();
    expect(result.userOp.paymasterPostOpGasLimit).toBeUndefined();
  });

  it("defaults maxGasUsdc to 1 USDC", async () => {
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      reader: fakeReader(),
      signer: recordingSigner(),
    });
    const result = await client.sponsorWithUsdc({ userOp: userOp() });
    expect(result.maxGasUsdc).toBe(1_000_000n);
  });

  it("applies estimator gas limits when provided", async () => {
    const estimator: BundlerGasEstimator = {
      async estimatePaymasterGas() {
        return {
          paymasterVerificationGasLimit: 55_000n,
          paymasterPostOpGasLimit: 33_000n,
        };
      },
    };
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      reader: fakeReader(),
      signer: recordingSigner(),
      estimator,
    });
    const result = await client.sponsorWithUsdc({ userOp: userOp() });
    expect(result.userOp.paymasterVerificationGasLimit).toBe(55_000n);
    expect(result.userOp.paymasterPostOpGasLimit).toBe(33_000n);
  });

  it("uses the v0.8 paymaster when configured", async () => {
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      entryPointVersion: "0.8",
      reader: fakeReader(),
      signer: recordingSigner(),
    });
    const result = await client.sponsorWithUsdc({ userOp: userOp() });
    expect(result.paymaster).toBe(CIRCLE_PAYMASTER_ADDRESS.testnet["0.8"]);
  });

  it("does not mutate the input UserOperation", async () => {
    const op = userOp();
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      reader: fakeReader(),
      signer: recordingSigner(),
    });
    await client.sponsorWithUsdc({ userOp: op });
    expect(op.paymaster).toBeUndefined();
    expect(op.paymasterData).toBeUndefined();
  });

  it("rejects a non-positive maxGasUsdc", async () => {
    const client = createPaymasterClient({
      chain: ARC_TESTNET,
      reader: fakeReader(),
      signer: recordingSigner(),
    });
    await expect(
      client.sponsorWithUsdc({ userOp: userOp(), maxGasUsdc: 0n }),
    ).rejects.toBeInstanceOf(SettleKitError);
  });
});
