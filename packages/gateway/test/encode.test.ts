import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  ERC20_APPROVE_ABI,
  GATEWAY_MINTER_ABI,
  GATEWAY_WALLET_ABI,
} from "../src/abi.js";
import {
  addressToBytes32,
  buildApproveTxRequest,
  buildBurnIntent,
  buildDepositForTxRequest,
  buildDepositTxRequest,
  buildGatewayMintTxRequest,
  buildInitiateWithdrawalTxRequest,
  buildTransferSpec,
  buildWithdrawTxRequest,
  toGatewayApiPayload,
  ZERO_BYTES32,
} from "../src/encode.js";
import type { Hex } from "../src/types.js";

const USDC = ARC_TESTNET.tokens.USDC.address as Hex;
const WALLET = ARC_TESTNET.contracts.gatewayWallet as Hex;
const MINTER = ARC_TESTNET.contracts.gatewayMinter as Hex;
const DEPOSITOR: Hex = "0x1111111111111111111111111111111111111111";
const RECIPIENT: Hex = "0x2222222222222222222222222222222222222222";
const SALT: Hex = `0x${"ab".repeat(32)}`;

describe("addressToBytes32", () => {
  it("left-pads a 20-byte address to 32 bytes", () => {
    expect(addressToBytes32(DEPOSITOR)).toBe(
      `0x${"0".repeat(24)}${DEPOSITOR.slice(2)}`,
    );
  });

  it("rejects non-addresses", () => {
    expect(() => addressToBytes32("0x1234")).toThrow(/EVM address/);
  });
});

describe("buildDepositTxRequest", () => {
  it("encodes deposit(token, value) to the GatewayWallet", () => {
    const tx = buildDepositTxRequest({
      gatewayWallet: WALLET,
      token: USDC,
      value: 25_000_000n,
    });
    expect(tx.to.toLowerCase()).toBe(WALLET.toLowerCase());
    expect(tx.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("deposit");
    expect(decoded.args[0]).toBe(USDC);
    expect(decoded.args[1]).toBe(25_000_000n);
  });

  it("rejects a zero-value deposit", () => {
    expect(() =>
      buildDepositTxRequest({ gatewayWallet: WALLET, token: USDC, value: 0n }),
    ).toThrow(/greater than zero/);
  });
});

describe("buildDepositForTxRequest", () => {
  it("encodes depositFor(token, depositor, value)", () => {
    const tx = buildDepositForTxRequest({
      gatewayWallet: WALLET,
      token: USDC,
      depositor: DEPOSITOR,
      value: 5_000_000n,
    });
    const decoded = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("depositFor");
    expect(decoded.args[1]).toBe(DEPOSITOR);
    expect(decoded.args[2]).toBe(5_000_000n);
  });
});

describe("buildApproveTxRequest", () => {
  it("encodes approve(gatewayWallet, value) on the token", () => {
    const tx = buildApproveTxRequest({
      token: USDC,
      gatewayWallet: WALLET,
      value: 100n,
    });
    expect(tx.to).toBe(USDC);
    const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: tx.data });
    expect(decoded.functionName).toBe("approve");
    expect(decoded.args[0]).toBe(WALLET);
    expect(decoded.args[1]).toBe(100n);
  });
});

describe("withdrawal encoders", () => {
  it("encodes initiateWithdrawal(token, value)", () => {
    const tx = buildInitiateWithdrawalTxRequest({
      gatewayWallet: WALLET,
      token: USDC,
      value: 1_000_000n,
    });
    const decoded = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("initiateWithdrawal");
    expect(decoded.args[1]).toBe(1_000_000n);
  });

  it("encodes withdraw(token)", () => {
    const tx = buildWithdrawTxRequest({ gatewayWallet: WALLET, token: USDC });
    const decoded = decodeFunctionData({ abi: GATEWAY_WALLET_ABI, data: tx.data });
    expect(decoded.functionName).toBe("withdraw");
    expect(decoded.args[0]).toBe(USDC);
  });
});

describe("buildTransferSpec / buildBurnIntent", () => {
  const baseParams = {
    sourceDomain: 0,
    destinationDomain: ARC_TESTNET.cctpDomain,
    sourceContract: WALLET,
    destinationContract: MINTER,
    sourceToken: USDC,
    destinationToken: USDC,
    sourceDepositor: DEPOSITOR,
    destinationRecipient: RECIPIENT,
    value: 10_000_000n,
    maxBlockHeight: 99_999_999n,
    maxFee: 2_000_000n,
    salt: SALT,
  };

  it("pads every address field to bytes32 and serializes amounts as decimal strings", () => {
    const spec = buildTransferSpec(baseParams);
    expect(spec.version).toBe(1);
    expect(spec.sourceDomain).toBe(0);
    expect(spec.destinationDomain).toBe(26);
    expect(spec.sourceDepositor).toBe(addressToBytes32(DEPOSITOR));
    expect(spec.destinationRecipient).toBe(addressToBytes32(RECIPIENT));
    expect(spec.value).toBe("10000000");
    expect(spec.salt).toBe(SALT);
    expect(spec.hookData).toBe("0x");
  });

  it("defaults sourceSigner to sourceDepositor and destinationCaller to zero", () => {
    const spec = buildTransferSpec(baseParams);
    expect(spec.sourceSigner).toBe(addressToBytes32(DEPOSITOR));
    expect(spec.destinationCaller).toBe(ZERO_BYTES32);
  });

  it("honors explicit sourceSigner / destinationCaller", () => {
    const spec = buildTransferSpec({
      ...baseParams,
      sourceSigner: RECIPIENT,
      destinationCaller: DEPOSITOR,
    });
    expect(spec.sourceSigner).toBe(addressToBytes32(RECIPIENT));
    expect(spec.destinationCaller).toBe(addressToBytes32(DEPOSITOR));
  });

  it("builds a full burn intent with maxBlockHeight/maxFee as decimal strings", () => {
    const intent = buildBurnIntent(baseParams);
    expect(intent.maxBlockHeight).toBe("99999999");
    expect(intent.maxFee).toBe("2000000");
    expect(intent.spec.value).toBe("10000000");
  });

  it("rejects a zero-value transfer", () => {
    expect(() => buildBurnIntent({ ...baseParams, value: 0n })).toThrow(
      /greater than zero/,
    );
  });

  it("rejects an invalid salt", () => {
    expect(() => buildBurnIntent({ ...baseParams, salt: "0x1234" as Hex })).toThrow(
      /32-byte hex/,
    );
  });
});

describe("toGatewayApiPayload", () => {
  it("passes a signed intent through and validates the signature", () => {
    const intent = buildBurnIntent({
      sourceDomain: 0,
      destinationDomain: 26,
      sourceContract: WALLET,
      destinationContract: MINTER,
      sourceToken: USDC,
      destinationToken: USDC,
      sourceDepositor: DEPOSITOR,
      destinationRecipient: RECIPIENT,
      value: 1_000_000n,
      maxBlockHeight: 1n,
      maxFee: 1n,
      salt: SALT,
    });
    const payload = toGatewayApiPayload({ burnIntent: intent, signature: "0xabcd" });
    expect(payload.burnIntent).toBe(intent);
    expect(payload.signature).toBe("0xabcd");
  });

  it("rejects a non-hex signature", () => {
    const intent = buildBurnIntent({
      sourceDomain: 0,
      destinationDomain: 26,
      sourceContract: WALLET,
      destinationContract: MINTER,
      sourceToken: USDC,
      destinationToken: USDC,
      sourceDepositor: DEPOSITOR,
      destinationRecipient: RECIPIENT,
      value: 1n,
      maxBlockHeight: 1n,
      maxFee: 1n,
      salt: SALT,
    });
    expect(() =>
      toGatewayApiPayload({ burnIntent: intent, signature: "nope" as Hex }),
    ).toThrow(/signature/);
  });
});

describe("buildGatewayMintTxRequest", () => {
  it("encodes gatewayMint(attestation, signature)", () => {
    const tx = buildGatewayMintTxRequest({
      gatewayMinter: MINTER,
      attestation: "0xdeadbeef",
      signature: "0xc0ffee",
    });
    expect(tx.to.toLowerCase()).toBe(MINTER.toLowerCase());
    const decoded = decodeFunctionData({ abi: GATEWAY_MINTER_ABI, data: tx.data });
    expect(decoded.functionName).toBe("gatewayMint");
    expect(decoded.args[0]).toBe("0xdeadbeef");
    expect(decoded.args[1]).toBe("0xc0ffee");
  });

  it("rejects an invalid minter address", () => {
    expect(() =>
      buildGatewayMintTxRequest({
        gatewayMinter: "0x00",
        attestation: "0xab",
        signature: "0xcd",
      }),
    ).toThrow(/gatewayMinter/);
  });
});
