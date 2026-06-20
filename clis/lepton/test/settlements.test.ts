import { describe, expect, it } from "vitest";
import type { SettlementReceipt } from "@settlekit/settlement-core";
import { parseStatus, receiptColumns } from "../src/commands/settlements.js";

describe("parseStatus", () => {
  it("accepts the four valid statuses", () => {
    expect(parseStatus("pending")).toBe("pending");
    expect(parseStatus("submitted")).toBe("submitted");
    expect(parseStatus("settled")).toBe("settled");
    expect(parseStatus("failed")).toBe("failed");
  });

  it("rejects an unknown status", () => {
    expect(() => parseStatus("done")).toThrow(/Invalid --status/);
  });
});

describe("receiptColumns", () => {
  it("projects the expected fields of a receipt", () => {
    const receipt: SettlementReceipt = {
      id: "rcpt_1",
      reference: "citation:1",
      to: "0xdead",
      amount: { amount: "1.00", currency: "USDC" },
      network: "arc",
      status: "settled",
      provider: "local",
      txHash: "0xtx",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const cols = receiptColumns();
    const headers = cols.map((c) => c.header);
    expect(headers).toEqual([
      "ID",
      "REFERENCE",
      "TO",
      "AMOUNT",
      "NETWORK",
      "STATUS",
      "PROVIDER",
      "TXHASH",
    ]);
    expect(cols[0]?.value(receipt)).toBe("rcpt_1");
    expect(cols[3]?.value(receipt)).toEqual({ amount: "1.00", currency: "USDC" });
    expect(cols[7]?.value(receipt)).toBe("0xtx");
  });
});
