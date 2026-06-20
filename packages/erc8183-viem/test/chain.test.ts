import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { getChain } from "@settlekit/arc-chains";
import { defineArcChain } from "../src/chain.js";

describe("defineArcChain", () => {
  it("builds a viem Chain from an explicit chainId + rpcUrl", () => {
    const rpcUrl = "https://rpc.example.test/";
    const chain = defineArcChain({ chainId: 4242, rpcUrl });
    expect(chain.id).toBe(4242);
    expect(chain.name).toBe("Arc Testnet");
    expect(chain.rpcUrls.default.http[0]).toBe(rpcUrl);
    expect(chain.testnet).toBe(true);
    expect(chain.nativeCurrency.decimals).toBe(6);
    expect(chain.blockExplorers?.default.url).toBe(getChain("Arc_Testnet").explorerUrl);
  });

  it("defaults rpcUrl to the arc-chains Arc Testnet endpoint", () => {
    const chain = defineArcChain({ chainId: 4242 });
    expect(chain.rpcUrls.default.http[0]).toBe(getChain("Arc_Testnet").rpcUrl);
  });

  it("throws validation_error when chainId resolves to the 0 sentinel", () => {
    expect(() => defineArcChain()).toThrow(SettleKitError);
    try {
      defineArcChain();
    } catch (e) {
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });
});
