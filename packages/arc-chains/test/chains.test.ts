import { describe, expect, it } from "vitest";
import {
  ARC_TESTNET_REGISTRIES,
  CHAINS,
  SUPPORTED_CHAINS,
  SUPPORTED_TOKENS,
  TOKENS,
  explorerAddressUrl,
  explorerTxUrl,
  getChain,
  getToken,
} from "../src/index.js";
import type { ChainDescriptor, SupportedChain } from "../src/index.js";

/** Chains whose endpoints are intentionally TODO (excluded from invariants). */
const TODO_CHAINS: readonly SupportedChain[] = ["Arc_Mainnet"];

describe("chains", () => {
  it("getChain returns the verified Arc Testnet descriptor", () => {
    const arc = getChain("Arc_Testnet");
    expect(arc.rpcUrl).toBe("https://rpc.testnet.arc.network/");
    expect(arc.explorerUrl).toBe("https://testnet.arcscan.app");
    expect(arc.testnet).toBe(true);
    expect(arc.key).toBe("Arc_Testnet");
  });

  it("getChain returns a mainnet (non-testnet) descriptor for Ethereum", () => {
    const eth = getChain("Ethereum");
    expect(eth.testnet).toBe(false);
    expect(eth.chainId).toBe(1);
  });

  it("explorerTxUrl builds the exact tx path", () => {
    const arc = getChain("Arc_Testnet");
    expect(explorerTxUrl(arc, "0xabc")).toBe(
      "https://testnet.arcscan.app/tx/0xabc",
    );
  });

  it("explorerAddressUrl builds the exact address path", () => {
    const arc = getChain("Arc_Testnet");
    expect(explorerAddressUrl(arc, "0xdef")).toBe(
      "https://testnet.arcscan.app/address/0xdef",
    );
  });

  it("CHAINS has exactly the 8 SupportedChain keys", () => {
    const keys = Object.keys(CHAINS);
    expect(keys).toHaveLength(8);
    expect([...keys].sort()).toEqual([...SUPPORTED_CHAINS].sort());
    expect(keys).toEqual(
      expect.arrayContaining([
        "Arc_Testnet",
        "Arc_Mainnet",
        "Ethereum_Sepolia",
        "Ethereum",
        "Base_Sepolia",
        "Base",
        "Arbitrum_Sepolia",
        "Arbitrum",
      ]),
    );
  });

  it("every non-TODO chain has non-empty rpcUrl and explorerUrl", () => {
    for (const chain of Object.values(CHAINS) as ChainDescriptor[]) {
      if (TODO_CHAINS.includes(chain.key)) continue;
      expect(chain.rpcUrl.length).toBeGreaterThan(0);
      expect(chain.explorerUrl.length).toBeGreaterThan(0);
    }
  });

  it("every chain descriptor's key matches its CHAINS record key", () => {
    for (const key of SUPPORTED_CHAINS) {
      expect(getChain(key).key).toBe(key);
    }
  });

  it("chainId is a positive unique integer for chains with a published id", () => {
    const ids = (Object.values(CHAINS) as ChainDescriptor[])
      // chainId 0 is the documented "not in docs" sentinel (Arc).
      .filter((c) => c.chainId !== 0)
      .map((c) => c.chainId);
    for (const id of ids) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(0);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("contracts", () => {
  it("ARC_TESTNET_REGISTRIES matches the documented ERC-8004 addresses", () => {
    expect(ARC_TESTNET_REGISTRIES.identityRegistry).toBe(
      "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    );
    expect(ARC_TESTNET_REGISTRIES.reputationRegistry).toBe(
      "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    );
    expect(ARC_TESTNET_REGISTRIES.validationRegistry).toBe(
      "0x8004Cb1BF31DAf7788923b405b754f57acEB4272",
    );
  });
});

describe("tokens", () => {
  it("USDC and EURC have 6 decimals", () => {
    expect(getToken("USDC").decimals).toBe(6);
    expect(getToken("EURC").decimals).toBe(6);
  });

  it("TOKENS key-set equals the 7-member SupportedToken union", () => {
    const keys = Object.keys(TOKENS);
    expect(keys).toHaveLength(7);
    expect([...keys].sort()).toEqual([...SUPPORTED_TOKENS].sort());
  });

  it("no token address is invented (all undefined or 0x-prefixed)", () => {
    for (const meta of Object.values(TOKENS)) {
      if (meta.address !== undefined) {
        expect(meta.address.startsWith("0x")).toBe(true);
      }
    }
  });
});
