import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import { computeFxQuote, invertFxRate, createStableFxClient } from "../src/index.js";
import type { FxQuoteInput } from "../src/index.js";

describe("computeFxQuote", () => {
  it("converts 100 USDC -> EURC at 0.92 with no fee, 6dp exact", () => {
    const input: FxQuoteInput = {
      sell: { amount: "100", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.92" },
    };
    const q = computeFxQuote(input);
    expect(q.gross).toEqual({ amount: "92", currency: "EURC" });
    expect(q.fee).toEqual({ amount: "0", currency: "EURC" });
    expect(q.buy).toEqual({ amount: "92", currency: "EURC" });
    expect(q.sell).toEqual({ amount: "100", currency: "USDC" });
  });

  it("applies a 10 bps fee on the quote side", () => {
    const q = computeFxQuote({
      sell: { amount: "100", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.92" },
      feeRate: "0.001",
    });
    // gross 92.000000, fee = 92 * 0.001 = 0.092, buy = 91.908
    expect(q.gross.amount).toBe("92");
    expect(q.fee.amount).toBe("0.092");
    expect(q.buy.amount).toBe("91.908");
  });

  it("rounds the converted amount to 6 decimals (half_even default)", () => {
    // 100 * 0.923456 = 92.3456 exactly (within 6dp) -> no rounding needed
    const exact = computeFxQuote({
      sell: { amount: "100", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.923456" },
    });
    expect(exact.gross.amount).toBe("92.3456");

    // 1 * 0.3333335 is invalid (>6dp rate); use a product that needs rounding:
    // 333.333333 * 0.000003 = 0.000999999999 -> 6dp half_even => 0.001
    const rounded = computeFxQuote({
      sell: { amount: "333.333333", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.000003" },
    });
    expect(rounded.gross.amount).toBe("0.001");
  });

  it("uses banker's rounding (round-half-to-even) at the exact half", () => {
    // Construct sell*rate = X.0000005 exactly so the dropped part is exactly 1/2.
    // 0.5 * 0.000001 = 0.0000005 -> base product = 500000 * 1 = 500000 (1e-12 units... )
    // sell_base=500000 (0.5), rate_base=1 (0.000001); product=500000; /1e6 => 0 rem 500000 (==half) => even => 0
    const half = computeFxQuote({
      sell: { amount: "0.5", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.000001" },
    });
    expect(half.gross.amount).toBe("0");

    // 1.5 * 0.000001 = 0.0000015 -> base product 1500000; /1e6 => 1 rem 500000 (==half) => odd->even => 2
    const halfUp = computeFxQuote({
      sell: { amount: "1.5", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.000001" },
    });
    expect(halfUp.gross.amount).toBe("0.000002");
  });

  it("honours floor and ceil rounding", () => {
    const base = {
      sell: { amount: "333.333333", currency: "USDC" as const },
      rate: { base: "USDC" as const, quote: "EURC" as const, rate: "0.000002" },
    };
    // 333.333333 * 0.000002 = 0.000666666666 -> 6dp
    expect(computeFxQuote({ ...base, rounding: "floor" }).gross.amount).toBe("0.000666");
    expect(computeFxQuote({ ...base, rounding: "ceil" }).gross.amount).toBe("0.000667");
  });

  it("rejects a rate whose base does not match the sell currency", () => {
    expect(() =>
      computeFxQuote({
        sell: { amount: "100", currency: "EURC" },
        rate: { base: "USDC", quote: "EURC", rate: "0.92" },
      }),
    ).toThrow(SettleKitError);
  });

  it("rejects a non-positive sell amount", () => {
    expect(() =>
      computeFxQuote({
        sell: { amount: "0", currency: "USDC" },
        rate: { base: "USDC", quote: "EURC", rate: "0.92" },
      }),
    ).toThrow(SettleKitError);
  });
});

describe("invertFxRate", () => {
  it("inverts a rate preserving 6dp", () => {
    const inv = invertFxRate({ base: "USDC", quote: "EURC", rate: "0.5" });
    expect(inv).toEqual({ base: "EURC", quote: "USDC", rate: "2" });
  });

  it("inverts 0.92 to ~1.086956 (6dp half_even)", () => {
    const inv = invertFxRate({ base: "USDC", quote: "EURC", rate: "0.92" });
    // 1 / 0.92 = 1.0869565... -> 6dp
    expect(inv.base).toBe("EURC");
    expect(inv.quote).toBe("USDC");
    expect(inv.rate).toBe("1.086957");
  });
});

describe("createStableFxClient FX surface", () => {
  it("quotes and builds a swap request against the Arc testnet FxEscrow", () => {
    const client = createStableFxClient({ apiKey: "test-key" });
    const quote = client.quote({
      sell: { amount: "100", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.92" },
    });
    expect(quote.buy).toEqual({ amount: "92", currency: "EURC" });

    const recipient = "0x1111111111111111111111111111111111111111";
    const req = client.buildSwapRequest({ quote, recipient });
    expect(req.sell).toEqual({ amount: "100", currency: "USDC" });
    expect(req.buyCurrency).toBe("EURC");
    expect(req.recipient).toBe(recipient);
    expect(req.tenor).toBe("instant");
    // Defaults to the published Arc testnet FxEscrow address.
    expect(req.escrow).toBe("0x867650F5eAe8df91445971f14d89fd84F0C9a9f8");
    expect(client.escrowAddress).toBe(req.escrow);
  });

  it("rejects an invalid recipient address", () => {
    const client = createStableFxClient({ apiKey: "k" });
    const quote = client.quote({
      sell: { amount: "1", currency: "USDC" },
      rate: { base: "USDC", quote: "EURC", rate: "0.9" },
    });
    expect(() => client.buildSwapRequest({ quote, recipient: "0xnope" })).toThrow(SettleKitError);
  });
});
