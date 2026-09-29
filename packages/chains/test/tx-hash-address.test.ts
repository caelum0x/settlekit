import { describe, expect, it } from "vitest";
import { PAYMENT_NETWORKS, type PaymentNetwork } from "@settlekit/common";
import { caip2For, checkPayTo, isValidPayTo, isValidTxHash, parseCaip2, parseTxHash, txHashFormatHint } from "../src/index.js";

const EVM_HASH = `0x${"Ab".repeat(32)}`;
const SOL_SIG = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const ZEC_TXID = "4C5B63098595B25090ABB69E6FBB5431CD58735857F96BC33C6324D503791357";
const EVM_ADDR = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const SOL_ADDR = "mvines9iiHiQTysrwkJjGf2gb9Ex9jXJX8ns3qwf2kN";
const ZEC_ADDR = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";

const EXPECT: Record<PaymentNetwork, { hash: string; normalized: string; payTo: string }> = {
  solana: { hash: SOL_SIG, normalized: SOL_SIG, payTo: SOL_ADDR },
  zcash: { hash: ZEC_TXID, normalized: ZEC_TXID.toLowerCase(), payTo: ZEC_ADDR },
  base: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  arc: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  ethereum: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  arbitrum: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  robinhood: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  hyperevm: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  hypercore: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
  tempo: { hash: EVM_HASH, normalized: EVM_HASH.toLowerCase(), payTo: EVM_ADDR },
};

describe.each([...PAYMENT_NETWORKS])("network %s", (network) => {
  const expected = EXPECT[network];

  it("accepts and normalizes its own tx id format", () => {
    expect(isValidTxHash(network, ` ${expected.hash} `)).toBe(true);
    expect(parseTxHash(network, expected.hash)).toBe(expected.normalized);
    expect(txHashFormatHint(network).length).toBeGreaterThan(10);
  });

  it("rejects every other family's tx id format", () => {
    for (const other of [EVM_HASH, SOL_SIG, ZEC_TXID]) {
      if (other === expected.hash) continue;
      expect(isValidTxHash(network, other), other).toBe(false);
    }
    expect(parseTxHash(network, "0xdeadbeef")).toBeNull();
  });

  it("validates payTo for its family only", () => {
    expect(isValidPayTo(network, expected.payTo)).toBe(true);
    for (const other of [EVM_ADDR, SOL_ADDR, ZEC_ADDR]) {
      if (other === expected.payTo) continue;
      expect(isValidPayTo(network, other), other).toBe(false);
    }
  });

  it("has a CAIP-2 id on mainnet", () => {
    const id = caip2For(network, network === "arc" ? "testnet" : "mainnet");
    expect(id && parseCaip2(id)).toBeTruthy();
  });
});

describe("payTo edge cases", () => {
  it("rejects the zero address and bad EIP-55 checksums", () => {
    expect(checkPayTo("base", "0x0000000000000000000000000000000000000000").ok).toBe(false);
    expect(isValidPayTo("base", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(true);
    expect(isValidPayTo("base", "0x833589FCD6eDb6E08f4c7C32D4f71b54bdA02913")).toBe(false);
  });

  it("requires the configured Zcash network and rejects shielded addresses", () => {
    expect(checkPayTo("zcash", ZEC_ADDR, { zcashNetwork: "testnet" })).toEqual({
      ok: false,
      reason: "must be a Zcash testnet transparent address",
    });
    expect(checkPayTo("zcash", "zs1abcdef")).toMatchObject({ ok: false, reason: expect.stringMatching(/shielded/) });
  });

  it("rejects a base58 Solana string that does not decode to 32 bytes", () => {
    expect(isValidPayTo("solana", "1111111111111111111111111111111")).toBe(false);
  });

  it("uses documented CAIP-2 ids", () => {
    expect(caip2For("base", "mainnet")).toBe("eip155:8453");
    expect(caip2For("tempo", "testnet")).toBe("eip155:42431");
    expect(caip2For("solana", "mainnet")).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(caip2For("zcash", "mainnet")).toBe("zcash:mainnet");
    expect(caip2For("arc", "mainnet")).toBeNull();
  });
});
