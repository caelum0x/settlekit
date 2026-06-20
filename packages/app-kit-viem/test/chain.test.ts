import { describe, expect, it } from "vitest";
import type { ChainDescriptor } from "@settlekit/arc-chains";
import { SettleKitError } from "@settlekit/common";
import { toViemChain } from "../src/index.js";

const SYNTHETIC: ChainDescriptor = {
  key: "Base_Sepolia",
  displayName: "Synthetic Test Chain",
  chainId: 84532,
  rpcUrl: "https://rpc.example.test/",
  explorerUrl: "https://explorer.example.test",
  testnet: true,
};

describe("toViemChain", () => {
  it("maps a non-zero descriptor to a viem Chain", () => {
    const chain = toViemChain(SYNTHETIC);
    expect(chain.id).toBe(84532);
    expect(chain.name).toBe("Synthetic Test Chain");
    expect(chain.rpcUrls.default.http[0]).toBe("https://rpc.example.test/");
    expect(chain.blockExplorers?.default.url).toBe(
      "https://explorer.example.test",
    );
    expect(chain.testnet).toBe(true);
  });

  it("defaults nativeCurrency to USDC (Arc gas), overridable", () => {
    expect(toViemChain(SYNTHETIC).nativeCurrency.symbol).toBe("USDC");
    const eth = toViemChain(SYNTHETIC, {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    });
    expect(eth.nativeCurrency.symbol).toBe("ETH");
    expect(eth.nativeCurrency.decimals).toBe(18);
  });

  it("throws on the chainId 0 sentinel (never invents)", () => {
    const arc: ChainDescriptor = { ...SYNTHETIC, chainId: 0 };
    expect(() => toViemChain(arc)).toThrow(SettleKitError);
  });

  it("throws on empty rpcUrl", () => {
    const noRpc: ChainDescriptor = { ...SYNTHETIC, rpcUrl: "" };
    try {
      toViemChain(noRpc);
      throw new Error("expected throw");
    } catch (e) {
      expect(SettleKitError.is(e)).toBe(true);
      expect((e as SettleKitError).code).toBe("validation_error");
    }
  });

  it("throws on empty explorerUrl", () => {
    const noExp: ChainDescriptor = { ...SYNTHETIC, explorerUrl: "" };
    expect(() => toViemChain(noExp)).toThrow(SettleKitError);
  });
});
