import { describe, expect, it } from "vitest";
import { hexToBytes } from "viem";
import {
  base58CheckDecode,
  base58Decode,
  base58Encode,
  encodeZcashTransparentAddress,
  isZcashTransparentAddress,
  parseZcashAddress,
} from "../src/index.js";

// Recorded from Blockchair (tx 4c5b6309…): recipient + its P2PKH script hash.
const REAL_T1 = "t1Ne88F8ouCV92brDXNBB47a85brvnEHE8g";
const REAL_T1_HASH = "0x344bf297cc708861717a25a48336538221673470";

describe("base58", () => {
  it("round-trips bytes including leading zeros", () => {
    const bytes = Uint8Array.from([0, 0, 1, 2, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
    expect(base58Encode(Uint8Array.from([0, 0]))).toBe("11");
  });

  it("rejects characters outside the alphabet", () => {
    expect(base58Decode("0OIl")).toBeNull();
  });
});

describe("parseZcashAddress", () => {
  it("accepts a real mainnet t1 address and recovers its script hash", () => {
    const parsed = parseZcashAddress(REAL_T1);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.network).toBe("mainnet");
    expect(parsed.kind).toBe("p2pkh");
    expect(parsed.hash).toEqual(hexToBytes(REAL_T1_HASH));
  });

  it("re-encodes the recovered hash to the same address", () => {
    expect(encodeZcashTransparentAddress("mainnet", "p2pkh", hexToBytes(REAL_T1_HASH))).toBe(REAL_T1);
  });

  it("produces the documented prefixes for every network/kind", () => {
    const hash = new Uint8Array(20).fill(7);
    expect(encodeZcashTransparentAddress("mainnet", "p2pkh", hash).startsWith("t1")).toBe(true);
    expect(encodeZcashTransparentAddress("mainnet", "p2sh", hash).startsWith("t3")).toBe(true);
    expect(encodeZcashTransparentAddress("testnet", "p2pkh", hash).startsWith("tm")).toBe(true);
    expect(encodeZcashTransparentAddress("testnet", "p2sh", hash).startsWith("t2")).toBe(true);
    const t3 = parseZcashAddress(encodeZcashTransparentAddress("mainnet", "p2sh", hash));
    expect(t3.ok && t3.kind).toBe("p2sh");
    const tm = parseZcashAddress(encodeZcashTransparentAddress("testnet", "p2pkh", hash));
    expect(tm.ok && tm.network).toBe("testnet");
  });

  it("rejects a checksum error (one character flipped)", () => {
    const flipped = `${REAL_T1.slice(0, -1)}${REAL_T1.endsWith("g") ? "h" : "g"}`;
    expect(base58CheckDecode(flipped)).toBeNull();
    expect(parseZcashAddress(flipped)).toEqual({ ok: false, reason: "invalid base58check encoding or checksum" });
  });

  it("rejects shielded addresses with an explicit reason", () => {
    for (const shielded of ["zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly", "u1abcdef"]) {
      const parsed = parseZcashAddress(shielded);
      expect(parsed.ok).toBe(false);
      expect(!parsed.ok && parsed.reason).toMatch(/shielded/);
    }
  });

  it("rejects a valid base58check payload with a foreign prefix (Bitcoin)", () => {
    expect(parseZcashAddress("1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2").ok).toBe(false);
  });

  it("filters by network", () => {
    expect(isZcashTransparentAddress(REAL_T1, "mainnet")).toBe(true);
    expect(isZcashTransparentAddress(REAL_T1, "testnet")).toBe(false);
  });
});
