import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { ARC_TESTNET } from "@settlekit/arc";
import { buildBurnIntent } from "../src/encode.js";
import {
  burnIntentDigest,
  burnIntentTypedData,
  GATEWAY_EIP712_DOMAIN,
  GATEWAY_EIP712_TYPES,
} from "../src/eip712.js";
import type { Hex } from "../src/types.js";

const USDC = ARC_TESTNET.tokens.USDC.address as Hex;
const WALLET = ARC_TESTNET.contracts.gatewayWallet as Hex;
const MINTER = ARC_TESTNET.contracts.gatewayMinter as Hex;
const DEPOSITOR: Hex = "0x1111111111111111111111111111111111111111";
const RECIPIENT: Hex = "0x2222222222222222222222222222222222222222";
const SALT: Hex = `0x${"ab".repeat(32)}`;

function makeIntent() {
  return buildBurnIntent({
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
  });
}

describe("Gateway EIP-712 domain", () => {
  it("uses only name + version (no chainId / verifyingContract)", () => {
    expect(GATEWAY_EIP712_DOMAIN).toEqual({ name: "GatewayWallet", version: "1" });
    expect("chainId" in GATEWAY_EIP712_DOMAIN).toBe(false);
    expect("verifyingContract" in GATEWAY_EIP712_DOMAIN).toBe(false);
  });

  it("orders TransferSpec fields exactly as the on-chain struct", () => {
    expect(GATEWAY_EIP712_TYPES.TransferSpec.map((f) => f.name)).toEqual([
      "version",
      "sourceDomain",
      "destinationDomain",
      "sourceContract",
      "destinationContract",
      "sourceToken",
      "destinationToken",
      "sourceDepositor",
      "destinationRecipient",
      "sourceSigner",
      "destinationCaller",
      "value",
      "salt",
      "hookData",
    ]);
  });
});

describe("burnIntentTypedData", () => {
  it("produces a signable payload with bigint amounts", () => {
    const td = burnIntentTypedData(makeIntent());
    expect(td.primaryType).toBe("BurnIntent");
    expect(td.message.maxBlockHeight).toBe(99_999_999n);
    const spec = td.message.spec as Record<string, unknown>;
    expect(spec.value).toBe(10_000_000n);
  });
});

describe("burnIntentDigest", () => {
  it("is deterministic for identical intents", () => {
    expect(burnIntentDigest(makeIntent())).toBe(burnIntentDigest(makeIntent()));
  });

  it("changes when any field changes", () => {
    const a = burnIntentDigest(makeIntent());
    const b = burnIntentDigest({ ...makeIntent(), maxFee: "3000000" });
    expect(a).not.toBe(b);
  });
});

describe("signing round-trip", () => {
  it("an EOA signature recovers to the signing address", async () => {
    // Deterministic test key (not a real secret).
    const account = privateKeyToAccount(`0x${"11".repeat(32)}` as Hex);
    const intent = makeIntent();
    const td = burnIntentTypedData(intent);
    const signature = await account.signTypedData({
      domain: td.domain,
      types: td.types,
      primaryType: td.primaryType,
      message: td.message,
    });
    const recovered = await recoverTypedDataAddress({
      domain: td.domain,
      types: td.types,
      primaryType: td.primaryType,
      message: td.message,
      signature,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
  });
});
