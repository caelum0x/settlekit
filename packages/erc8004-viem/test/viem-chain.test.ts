import { describe, expect, it } from "vitest";
import { getChain } from "@settlekit/arc-chains";
import {
  ARC_TESTNET_CHAIN_ID,
  arcTestnetChain,
  defineArcChain,
} from "../src/index.js";

describe("defineArcChain", () => {
  const descriptor = getChain("Arc_Testnet");

  it("builds rpcUrls/blockExplorers from arc-chains constants", () => {
    const chain = defineArcChain();
    expect(chain.rpcUrls.default.http[0]).toBe(descriptor.rpcUrl);
    expect(chain.blockExplorers?.default.url).toBe(descriptor.explorerUrl);
    expect(chain.blockExplorers?.default.name).toBe("Arcscan");
    expect(chain.name).toBe(descriptor.displayName);
    expect(chain.testnet).toBe(true);
  });

  it("defaults the chain id to the best-known Arc Testnet id (never 0)", () => {
    expect(defineArcChain().id).toBe(ARC_TESTNET_CHAIN_ID);
    expect(defineArcChain().id).not.toBe(0);
  });

  it("honors a chainId override", () => {
    expect(defineArcChain({ chainId: 5_042_002 }).id).toBe(5_042_002);
    expect(defineArcChain({ chainId: 999 }).id).toBe(999);
  });

  it("honors rpcUrl/explorerUrl overrides", () => {
    const chain = defineArcChain({
      rpcUrl: "https://example.test/rpc",
      explorerUrl: "https://example.test/scan",
    });
    expect(chain.rpcUrls.default.http[0]).toBe("https://example.test/rpc");
    expect(chain.blockExplorers?.default.url).toBe("https://example.test/scan");
  });

  it("uses USDC as the native currency", () => {
    expect(defineArcChain().nativeCurrency).toEqual({
      name: "USD Coin",
      symbol: "USDC",
      decimals: 18,
    });
  });

  it("exposes a ready-built default chain", () => {
    expect(arcTestnetChain.id).toBe(ARC_TESTNET_CHAIN_ID);
    expect(arcTestnetChain.rpcUrls.default.http[0]).toBe(descriptor.rpcUrl);
  });
});
