import { describe, expect, it } from "vitest";
import { accountBalance, ledgerBalances } from "../src/index.js";

describe("ledger", () => {
  it("calculates account balances", () => {
    const entries = [
      { accountId: "merchant", direction: "credit" as const, amount: { amount: "25", currency: "USDC" as const }, memo: "payment" },
      { accountId: "merchant", direction: "debit" as const, amount: { amount: "1", currency: "USDC" as const }, memo: "fee" },
    ];
    expect(accountBalance(entries, "merchant").amount).toBe("24");
    expect(ledgerBalances(entries).merchant?.amount).toBe("24");
  });
});
