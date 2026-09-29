import { describe, expect, it } from "vitest";
import { depositPaymentUri, formatBaseUnits, ORIGIN_CHAINS, originExplorerTxUrl } from "../src/index.js";

describe("origin helpers", () => {
  it("formats base units", () => {
    expect(formatBaseUnits("5027158", 6)).toBe("5.027158");
    expect(formatBaseUnits("5000000", 6)).toBe("5");
    expect(formatBaseUnits("1857730872909050", 18)).toBe("0.00185773087290905");
    expect(formatBaseUnits("7", 0)).toBe("7");
    expect(formatBaseUnits("abc", 6)).toBe("abc");
  });

  it("builds deposit URIs (EIP-681 ERC-20 / native, Solana Pay)", () => {
    const deposit = "0x3f33AFf7Fdac46663d03e14E7f3cAB0aeCbC8378";
    expect(depositPaymentUri(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", deposit, "5035264")).toBe(
      `ethereum:0xaf88d065e77c8cc2239327c5edb3a432268e5831@42161/transfer?address=${deposit}&uint256=5035264`,
    );
    expect(depositPaymentUri(8453, "0x0000000000000000000000000000000000000000", deposit, "1000")).toBe(`ethereum:${deposit}@8453?value=1000`);
    expect(depositPaymentUri(792703809, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Dep1", "2500000")).toBe(
      "solana:Dep1?amount=2.5&spl-token=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    );
    expect(depositPaymentUri(792703809, "11111111111111111111111111111111", "Dep1", "10000000")).toBe("solana:Dep1?amount=0.01");
    expect(depositPaymentUri(7777, "0x0", deposit, "1")).toBeNull();
    expect(depositPaymentUri(42161, "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", deposit, "1.5")).toBeNull();
  });

  it("links origin explorers", () => {
    expect(originExplorerTxUrl(8453, "0xabc")).toBe("https://basescan.org/tx/0xabc");
    expect(originExplorerTxUrl(792703809, "sig")).toBe("https://solscan.io/tx/sig");
    expect(originExplorerTxUrl(7777, "0xabc")).toBe("");
  });

  it("offers lowercase EVM token addresses and unique chains", () => {
    const ids = ORIGIN_CHAINS.map((chain) => chain.chainId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chain of ORIGIN_CHAINS.filter((entry) => entry.vm === "evm")) {
      for (const token of chain.tokens) expect(token.address).toBe(token.address.toLowerCase());
    }
  });
});
