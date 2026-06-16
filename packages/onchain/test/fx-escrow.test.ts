import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import {
  FX_WITNESS_TYPES,
  FX_EIP712_TYPES,
  buildBreachTx,
  encodeGetTradeDetails,
  PERMIT2_ADDRESS,
} from "../src/fx-escrow.js";
import { FX_ESCROW_ABI } from "../src/fx-escrow-abi.js";

describe("FxEscrow EIP-712 (sourced from the verified on-chain contract)", () => {
  it("Consideration struct matches the on-chain TAKER witness type string", () => {
    // The on-chain TAKER_DETAILS_WITNESS_TYPE embeds the Consideration struct.
    const considerationStr =
      "Consideration(bytes32 quoteId,address base,address quote,uint256 baseAmount,uint256 quoteAmount,uint256 maturity)";
    expect(FX_WITNESS_TYPES.taker).toContain(considerationStr);
    // The TS type def must mirror the same fields in order.
    const fields = FX_EIP712_TYPES.Consideration.map((f) => `${f.type} ${f.name}`).join(",");
    expect(considerationStr).toContain(fields);
  });

  it("Permit2 address is the canonical singleton", () => {
    expect(PERMIT2_ADDRESS).toBe("0x000000000022D473030F116dDEE9F6B43aC78BA3");
  });
});

describe("FxEscrow tx-builders (real ABI)", () => {
  it("encodes breach(tradeId) and decodes back", () => {
    const req = buildBreachTx(476n);
    expect(req.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: FX_ESCROW_ABI, data: req.data });
    expect(decoded.functionName).toBe("breach");
    expect(decoded.args[0]).toBe(476n);
  });

  it("encodes getTradeDetails(tradeId)", () => {
    const data = encodeGetTradeDetails(1n);
    const decoded = decodeFunctionData({ abi: FX_ESCROW_ABI, data });
    expect(decoded.functionName).toBe("getTradeDetails");
  });

  it("the captured ABI includes recordTrade / takerDeliver / makerDeliver", () => {
    const names = FX_ESCROW_ABI.filter((e) => e.type === "function").map((e) => e.name);
    expect(names).toContain("recordTrade");
    expect(names).toContain("takerDeliver");
    expect(names).toContain("makerDeliver");
  });
});
