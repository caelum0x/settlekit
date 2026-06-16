import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeFunctionData,
  toFunctionSelector,
} from "viem";
import { SettleKitError } from "@settlekit/common";
import {
  addressToBytes32,
  buildDepositForBurnTx,
  buildReceiveMessageTx,
  encodeDepositForBurn,
  encodeReceiveMessage,
  MESSAGE_TRANSMITTER_V2_ABI,
  TOKEN_MESSENGER_V2_ABI,
  ZERO_BYTES32,
} from "../src/index.js";
import type { Hex } from "../src/index.js";

const MINT_RECIPIENT: Hex = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const BURN_TOKEN: Hex = "0x3600000000000000000000000000000000000000";
const TOKEN_MESSENGER: Hex = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER: Hex = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";

describe("addressToBytes32", () => {
  it("left-pads a 20-byte address into 32 bytes", () => {
    const out = addressToBytes32(MINT_RECIPIENT);
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
    // 12 leading zero bytes (24 hex chars) then the lowercased address.
    expect(out).toBe(`0x${"0".repeat(24)}${MINT_RECIPIENT.slice(2).toLowerCase()}`);
  });

  it("rejects invalid addresses", () => {
    expect(() => addressToBytes32("0x1234" as Hex)).toThrow(SettleKitError);
  });
});

describe("encodeDepositForBurn", () => {
  it("encodes the depositForBurn selector and args", () => {
    const data = encodeDepositForBurn({
      amount: 1_000_000n,
      destinationDomain: 26,
      mintRecipient: MINT_RECIPIENT,
      burnToken: BURN_TOKEN,
      maxFee: 0n,
      minFinalityThreshold: 1000,
      tokenMessenger: TOKEN_MESSENGER,
    });

    const expectedSelector = toFunctionSelector(
      "depositForBurn(uint256,uint32,bytes32,address,bytes32,uint256,uint32)",
    );
    expect(data.slice(0, 10)).toBe(expectedSelector);

    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    expect(decoded.functionName).toBe("depositForBurn");
    expect(decoded.args).toEqual([
      1_000_000n,
      26,
      addressToBytes32(MINT_RECIPIENT),
      BURN_TOKEN, // checksummed by viem decode
      ZERO_BYTES32,
      0n,
      1000,
    ]);
  });

  it("defaults destinationCaller to bytes32(0) and finality to Standard", () => {
    const data = encodeDepositForBurn({
      amount: 500n,
      destinationDomain: 6,
      mintRecipient: MINT_RECIPIENT,
      burnToken: BURN_TOKEN,
      maxFee: 0n,
      tokenMessenger: TOKEN_MESSENGER,
    });
    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    expect(decoded.args?.[4]).toBe(ZERO_BYTES32);
    expect(decoded.args?.[6]).toBe(1000);
  });

  it("uses depositForBurnWithHook when hookData is present", () => {
    const data = encodeDepositForBurn({
      amount: 1_000_000n,
      destinationDomain: 26,
      mintRecipient: MINT_RECIPIENT,
      burnToken: BURN_TOKEN,
      maxFee: 10n,
      tokenMessenger: TOKEN_MESSENGER,
      hookData: "0xdeadbeef",
    });
    const expectedSelector = toFunctionSelector(
      "depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)",
    );
    expect(data.slice(0, 10)).toBe(expectedSelector);
    const decoded = decodeFunctionData({ abi: TOKEN_MESSENGER_V2_ABI, data });
    expect(decoded.functionName).toBe("depositForBurnWithHook");
    expect(decoded.args?.[7]).toBe("0xdeadbeef");
  });

  it("rejects zero and negative amounts", () => {
    const base = {
      destinationDomain: 26,
      mintRecipient: MINT_RECIPIENT,
      burnToken: BURN_TOKEN,
      maxFee: 0n,
      tokenMessenger: TOKEN_MESSENGER,
    };
    expect(() => encodeDepositForBurn({ ...base, amount: 0n })).toThrow(
      SettleKitError,
    );
    expect(() => encodeDepositForBurn({ ...base, amount: -1n })).toThrow(
      SettleKitError,
    );
  });
});

describe("buildDepositForBurnTx", () => {
  it("targets the TokenMessenger with value 0 and matching calldata", () => {
    const input = {
      amount: 1_000_000n,
      destinationDomain: 26,
      mintRecipient: MINT_RECIPIENT,
      burnToken: BURN_TOKEN,
      maxFee: 0n,
      tokenMessenger: TOKEN_MESSENGER,
    };
    const tx = buildDepositForBurnTx(input);
    expect(tx.to).toBe(TOKEN_MESSENGER);
    expect(tx.value).toBe(0n);
    expect(tx.data).toBe(encodeDepositForBurn(input));
  });
});

describe("encodeReceiveMessage / buildReceiveMessageTx", () => {
  it("encodes the receiveMessage selector and args", () => {
    const message: Hex = "0x00000001abcdef";
    const attestation: Hex = "0xdeadbeefcafe";
    const data = encodeReceiveMessage({
      message,
      attestation,
      messageTransmitter: MESSAGE_TRANSMITTER,
    });
    const expectedSelector = toFunctionSelector("receiveMessage(bytes,bytes)");
    expect(data.slice(0, 10)).toBe(expectedSelector);

    expect(data).toBe(
      encodeFunctionData({
        abi: MESSAGE_TRANSMITTER_V2_ABI,
        functionName: "receiveMessage",
        args: [message, attestation],
      }),
    );

    const tx = buildReceiveMessageTx({
      message,
      attestation,
      messageTransmitter: MESSAGE_TRANSMITTER,
    });
    expect(tx.to).toBe(MESSAGE_TRANSMITTER);
    expect(tx.value).toBe(0n);
    expect(tx.data).toBe(data);
  });

  it("rejects non-hex message or attestation", () => {
    expect(() =>
      encodeReceiveMessage({
        message: "not-hex" as Hex,
        attestation: "0xab",
        messageTransmitter: MESSAGE_TRANSMITTER,
      }),
    ).toThrow(SettleKitError);
  });
});
