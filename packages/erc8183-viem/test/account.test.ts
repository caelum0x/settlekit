import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { SettleKitError } from "@settlekit/common";
import { isPrivateKey, readPrivateKeyFromEnv, resolveAccount } from "../src/account.js";
import type { Hex } from "../src/types.js";

// Well-known throwaway Anvil account #0 key — public test vector, never a secret.
const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as Hex;
const ANVIL_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("resolveAccount", () => {
  it("derives the stable checksum address from a fixed private key", () => {
    const account = resolveAccount({ privateKey: ANVIL_KEY });
    expect(account.address).toBe(ANVIL_ADDRESS);
  });

  it("prefers an injected account over a private key", () => {
    const injected = privateKeyToAccount(ANVIL_KEY);
    const account = resolveAccount({ account: injected, privateKey: ANVIL_KEY });
    expect(account).toBe(injected);
  });

  it("throws validation_error for a malformed key (wrong length)", () => {
    expect(() => resolveAccount({ privateKey: "0xdeadbeef" as Hex })).toThrow(
      SettleKitError,
    );
    try {
      resolveAccount({ privateKey: "0xdeadbeef" as Hex });
    } catch (e) {
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });

  it("throws validation_error for a non-hex key", () => {
    const bad = ("0x" + "z".repeat(64)) as Hex;
    expect(() => resolveAccount({ privateKey: bad })).toThrow(SettleKitError);
  });

  it("throws validation_error when no signer is supplied", () => {
    expect(() => resolveAccount({})).toThrow(SettleKitError);
  });
});

describe("isPrivateKey", () => {
  it("accepts a valid 0x + 64-hex key and rejects others", () => {
    expect(isPrivateKey(ANVIL_KEY)).toBe(true);
    expect(isPrivateKey("0x123")).toBe(false);
    expect(isPrivateKey("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")).toBe(false);
  });
});

describe("readPrivateKeyFromEnv", () => {
  it("returns undefined when unset (no throw)", () => {
    expect(readPrivateKeyFromEnv({})).toBeUndefined();
    expect(readPrivateKeyFromEnv({ ERC8183_PRIVATE_KEY: "" })).toBeUndefined();
  });

  it("returns the key when set and valid", () => {
    expect(readPrivateKeyFromEnv({ ERC8183_PRIVATE_KEY: ANVIL_KEY })).toBe(ANVIL_KEY);
  });

  it("supports a custom variable name", () => {
    expect(readPrivateKeyFromEnv({ MY_KEY: ANVIL_KEY }, "MY_KEY")).toBe(ANVIL_KEY);
  });

  it("throws validation_error when set but malformed", () => {
    expect(() => readPrivateKeyFromEnv({ ERC8183_PRIVATE_KEY: "nope" })).toThrow(
      SettleKitError,
    );
  });
});
