import { describe, it, expect } from "vitest";
import { money } from "@settlekit/common";
import {
  marketplaceFee,
  splitFee,
  MIN_FEE_BPS,
  MAX_FEE_BPS,
} from "../src/fees.js";

describe("marketplaceFee", () => {
  it("computes 5% of a round amount", () => {
    const fee = marketplaceFee(money("100.00"), 500);
    expect(fee.amount).toBe("5");
    expect(fee.currency).toBe("USDC");
  });

  it("computes 15% (the cap) of an amount", () => {
    const fee = marketplaceFee(money("200.00"), 1_500);
    expect(fee.amount).toBe("30");
  });

  it("computes 10% with fractional base units, flooring", () => {
    // 12.345678 * 1000bps = 1.2345678 -> floor at micro-unit precision
    const fee = marketplaceFee(money("12.345678"), 1_000);
    expect(fee.amount).toBe("1.234567");
  });

  it("floors rather than rounds so the platform never over-charges", () => {
    // 0.000019 * 500bps = 0.00000095 -> floors to 0
    const fee = marketplaceFee(money("0.000019"), 500);
    expect(fee.amount).toBe("0");
  });

  it("rejects fees below the 5% floor", () => {
    expect(() => marketplaceFee(money("100"), MIN_FEE_BPS - 1)).toThrow();
  });

  it("rejects fees above the 15% ceiling", () => {
    expect(() => marketplaceFee(money("100"), MAX_FEE_BPS + 1)).toThrow();
  });

  it("rejects non-integer bps", () => {
    expect(() => marketplaceFee(money("100"), 750.5)).toThrow();
  });
});

describe("splitFee", () => {
  it("splits gross into fee and net with no leakage", () => {
    const split = splitFee(money("100.00"), 750); // 7.5%
    expect(split.fee.amount).toBe("7.5");
    expect(split.net.amount).toBe("92.5");
    expect(split.gross.amount).toBe("100");
  });

  it("fee + net reconstitutes gross exactly even with flooring", () => {
    const gross = money("12.345678");
    const split = splitFee(gross, 1_000);
    const recombined =
      Number(split.fee.amount) + Number(split.net.amount);
    expect(recombined).toBeCloseTo(Number(gross.amount), 6);
  });
});
