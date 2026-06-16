import { describe, expect, it } from "vitest";
import { ARC_TESTNET } from "@settlekit/arc";
import {
  CCTP_DOMAINS,
  getCctpChainName,
  getCctpDomain,
  isKnownCctpDomain,
} from "../src/index.js";

describe("CCTP domains", () => {
  it("maps canonical chain names to their published domain ids", () => {
    expect(getCctpDomain("ethereum")).toBe(0);
    expect(getCctpDomain("avalanche")).toBe(1);
    expect(getCctpDomain("optimism")).toBe(2);
    expect(getCctpDomain("arbitrum")).toBe(3);
    expect(getCctpDomain("solana")).toBe(5);
    expect(getCctpDomain("base")).toBe(6);
    expect(getCctpDomain("polygon")).toBe(7);
    expect(getCctpDomain("arc")).toBe(26);
  });

  it("agrees with @settlekit/arc on Arc's CCTP domain", () => {
    expect(getCctpDomain("arc")).toBe(ARC_TESTNET.cctpDomain);
  });

  it("reverses domain ids back to chain names", () => {
    expect(getCctpChainName(0)).toBe("ethereum");
    expect(getCctpChainName(6)).toBe("base");
    expect(getCctpChainName(26)).toBe("arc");
    expect(getCctpChainName(9999)).toBeUndefined();
  });

  it("has a unique domain id per chain (no collisions)", () => {
    const ids = Object.values(CCTP_DOMAINS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("recognizes known and unknown domains", () => {
    expect(isKnownCctpDomain(0)).toBe(true);
    expect(isKnownCctpDomain(26)).toBe(true);
    expect(isKnownCctpDomain(9999)).toBe(false);
  });
});
