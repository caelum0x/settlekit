import { describe, expect, it } from "vitest";
import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
import { UsdSendTypes } from "@nktkas/hyperliquid/api/exchange";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildUsdSendAction,
  canonicalUsdAmount,
  joinSignature,
  recoverUsdSendSigner,
  splitSignature,
  USD_SEND_TYPES,
  usdSendDigest,
  usdSendTypedData,
  UsdSendError,
} from "../src/index.js";

// Well-known Anvil/Hardhat test account #1 (never holds real funds).
const TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const wallet = privateKeyToAccount(TEST_KEY);
const DESTINATION = "0x1F2E3D4C5B6A79880706A5B4C3D2E1F0A9B8C7D6";
const TIME = 1790691879536;

/**
 * Golden vectors: produced once by `@nktkas/hyperliquid`'s own
 * `signUserSignedAction` with UsdSendTypes (2026-09-29) and pinned here, so a
 * change to our typed data (or to the SDK) is caught.
 */
const GOLDEN = [
  {
    chain: "Mainnet",
    signatureChainId: 42161,
    digest: "0x39b1397e6738fc2628f0cf8eeec2eb61bf7481d05ba4856f619946f0a783c5d6",
    signature: {
      r: "0x26c12bb58c7ac20eae8b661d7afe0399133a756e50c44a8b1d506c4274d6c491",
      s: "0x4bea04d55474e386d4bbb9564d99017526a86eaa08d1e5476214920ff31e6499",
      v: 28,
    },
  },
  {
    chain: "Testnet",
    signatureChainId: 421614,
    digest: "0x198583bb90961ef158cd0092f4e1966da8259716147d85a5d954b14e6b5eca0e",
    signature: {
      r: "0x6846bfe70511b2d0dc14f7b167c25fc5d88d5e7b72e929f62e0632d928f4d9e1",
      s: "0x5fa7745242545ab420b0540a5cc1a807ee7639f8420991caded67c27aef3810b",
      v: 27,
    },
  },
] as const;

describe.each(GOLDEN)("usdSend golden vector ($chain)", (vector) => {
  const action = buildUsdSendAction({
    destination: DESTINATION,
    amount: "25.50",
    time: TIME,
    hyperliquidChain: vector.chain,
    signatureChainId: vector.signatureChainId,
  });

  it("builds the canonical action (lowercase destination, trimmed amount, hex chain id)", () => {
    expect(action).toEqual({
      type: "usdSend",
      signatureChainId: `0x${vector.signatureChainId.toString(16)}`,
      hyperliquidChain: vector.chain,
      destination: DESTINATION.toLowerCase(),
      amount: "25.5",
      time: TIME,
    });
    expect(Object.keys(action)).toEqual(["type", "signatureChainId", "hyperliquidChain", "destination", "amount", "time"]);
  });

  it("hashes to the pinned EIP-712 digest", () => {
    expect(usdSendDigest(action)).toBe(vector.digest);
  });

  it("signs exactly like the SDK", async () => {
    const ours = splitSignature(await wallet.signTypedData(usdSendTypedData(action)));
    expect(ours).toEqual(vector.signature);
    const sdk = await signUserSignedAction({ wallet, action, types: UsdSendTypes });
    expect(sdk).toEqual(vector.signature);
  });

  it("recovers the signer from the signature", async () => {
    expect(await recoverUsdSendSigner(action, vector.signature)).toBe(wallet.address);
    expect(await recoverUsdSendSigner(action, joinSignature(vector.signature))).toBe(wallet.address);
  });

  it("recovers a different address when the amount is tampered with", async () => {
    const tampered = { ...action, amount: "2550" };
    expect(await recoverUsdSendSigner(tampered, vector.signature)).not.toBe(wallet.address);
  });
});

describe("usdSend typed data helpers", () => {
  it("uses the SDK's EIP-712 type list", () => {
    expect(USD_SEND_TYPES).toEqual(UsdSendTypes);
  });

  it("canonicalizes amounts", () => {
    expect(canonicalUsdAmount("10.000000")).toBe("10");
    expect(canonicalUsdAmount("0.010")).toBe("0.01");
    expect(canonicalUsdAmount("1")).toBe("1");
    expect(() => canonicalUsdAmount("0")).toThrow(UsdSendError);
    expect(() => canonicalUsdAmount("0.000")).toThrow(UsdSendError);
    expect(() => canonicalUsdAmount("-1")).toThrow(UsdSendError);
    expect(() => canonicalUsdAmount("1e3")).toThrow(UsdSendError);
  });

  it("rejects invalid actions", () => {
    const base = { destination: DESTINATION, amount: "1", time: TIME, hyperliquidChain: "Mainnet" as const, signatureChainId: 1 };
    expect(() => buildUsdSendAction({ ...base, destination: "0x1234" })).toThrow(/destination/);
    expect(() => buildUsdSendAction({ ...base, time: 0 })).toThrow(/time/);
    expect(() => buildUsdSendAction({ ...base, signatureChainId: "abc" })).toThrow(/signatureChainId/);
    expect(() => buildUsdSendAction({ ...base, hyperliquidChain: "Devnet" as "Mainnet" })).toThrow(/hyperliquidChain/);
    expect(buildUsdSendAction({ ...base, signatureChainId: "0x0A4B1" }).signatureChainId).toBe("0xa4b1");
  });

  it("splits and normalizes signatures", () => {
    const joined = joinSignature(GOLDEN[0].signature);
    expect(splitSignature(joined)).toEqual(GOLDEN[0].signature);
    const legacyV = `${joined.slice(0, 130)}01`;
    expect(splitSignature(legacyV).v).toBe(28);
    expect(() => splitSignature("0x1234")).toThrow(UsdSendError);
    expect(() => splitSignature(`${joined.slice(0, 130)}05`)).toThrow(/recovery id/);
  });
});
