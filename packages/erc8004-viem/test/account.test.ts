import { describe, expect, it } from "vitest";
import { deriveAccount } from "../src/index.js";

// Well-known anvil test key #0 — deterministic, public, NOT a real secret.
const ANVIL_KEY_0 =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_ADDR_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("deriveAccount", () => {
  it("derives the known address from the fixed anvil key", () => {
    const account = deriveAccount(ANVIL_KEY_0);
    expect(account.address).toBe(ANVIL_ADDR_0);
  });

  it("is deterministic across calls", () => {
    expect(deriveAccount(ANVIL_KEY_0).address).toBe(
      deriveAccount(ANVIL_KEY_0).address,
    );
  });

  it("produces a local account with a source of 'privateKey'", () => {
    expect(deriveAccount(ANVIL_KEY_0).source).toBe("privateKey");
  });
});
