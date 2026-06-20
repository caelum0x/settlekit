import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { createViemAppKitSdk, notSupported } from "../src/index.js";
import type { ViemAppKitConfig } from "../src/index.js";

// No signer needed: these throw before any client is constructed (no network).
const CONFIG: ViemAppKitConfig = {};

const sdk = createViemAppKitSdk<string>(CONFIG);

async function expectUnsupported(p: Promise<unknown>): Promise<void> {
  try {
    await p;
    throw new Error("expected rejection");
  } catch (e) {
    expect(SettleKitError.is(e)).toBe(true);
    expect((e as SettleKitError).message).toContain(
      "not supported by the viem backend",
    );
  }
}

describe("unsupported capabilities", () => {
  it("bridge rejects", async () => {
    await expectUnsupported(
      sdk.bridge({
        from: { adapter: "a", chain: "Arc_Testnet" },
        to: { adapter: "a", chain: "Base" },
        amount: "1",
      }),
    );
  });

  it("swap rejects", async () => {
    await expectUnsupported(
      sdk.swap({
        from: { adapter: "a", chain: "Arc_Testnet" },
        tokenIn: "USDC",
        tokenOut: "EURC",
        amountIn: "1",
      }),
    );
  });

  it("unifiedBalance.deposit rejects", async () => {
    await expectUnsupported(
      sdk.unifiedBalance.deposit({
        from: { adapter: "a", chain: "Arc_Testnet" },
        amount: "1",
        token: "USDC",
      }),
    );
  });

  it("unifiedBalance.spend rejects", async () => {
    await expectUnsupported(
      sdk.unifiedBalance.spend({
        from: { adapter: "a" },
        amountIn: "1",
        to: { adapter: "a", chain: "Base", recipientAddress: "0x0" },
      }),
    );
  });

  it("notSupported() throws SettleKitError(validation_error)", () => {
    try {
      notSupported("bridge");
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});
