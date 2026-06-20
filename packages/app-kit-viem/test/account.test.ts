import { describe, expect, it } from "vitest";
import type { Account, PublicClient, WalletClient } from "viem";
import { SettleKitError } from "@settlekit/common";
import { resolveAccount, resolveWallet } from "../src/index.js";
import type { InjectedWallet, ViemAppKitConfig } from "../src/index.js";

// Well-known Anvil/Hardhat test private key #0. CLEARLY a public test value —
// never a real secret. Used only to assert deterministic key->address derivation.
const FAKE_TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FAKE_TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Minimal stubs — never used by these tests (we exercise the injected path only).
const fakeAccount = { address: FAKE_TEST_ADDRESS } as unknown as Account;
const fakeWalletClient = {} as unknown as WalletClient;
const fakePublicClient = {} as unknown as PublicClient;
const injected: InjectedWallet = {
  account: fakeAccount,
  walletClient: fakeWalletClient,
  publicClient: fakePublicClient,
};
const fakeChain = { id: 1 } as unknown as Parameters<typeof resolveWallet>[1];

describe("resolveAccount", () => {
  it("returns the injected account unchanged", () => {
    expect(resolveAccount({ wallet: injected })).toBe(fakeAccount);
  });

  it("derives the deterministic address from a config private key", () => {
    const account = resolveAccount({ privateKey: FAKE_TEST_KEY });
    expect(account.address).toBe(FAKE_TEST_ADDRESS);
  });

  it("reads the key from an injected env object (not process.env)", () => {
    const env = { SETTLEKIT_PRIVATE_KEY: FAKE_TEST_KEY };
    const account = resolveAccount({ env });
    expect(account.address).toBe(FAKE_TEST_ADDRESS);
  });

  it("reads the key from a custom env var name", () => {
    const env = { MY_KEY: FAKE_TEST_KEY };
    const account = resolveAccount({ env, privateKeyEnv: "MY_KEY" });
    expect(account.address).toBe(FAKE_TEST_ADDRESS);
  });

  it("throws when neither injected wallet nor key/env present", () => {
    const config: ViemAppKitConfig = { env: {} };
    try {
      resolveAccount(config);
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});

describe("resolveWallet", () => {
  it("returns injected clients unchanged (no transport built)", () => {
    const resolved = resolveWallet(
      { wallet: injected },
      fakeChain,
      "https://unused.test/",
    );
    expect(resolved.account).toBe(fakeAccount);
    expect(resolved.walletClient).toBe(fakeWalletClient);
    expect(resolved.publicClient).toBe(fakePublicClient);
  });

  it("throws when no signer is configured", () => {
    expect(() =>
      resolveWallet({ env: {} }, fakeChain, "https://unused.test/"),
    ).toThrow(SettleKitError);
  });
});
