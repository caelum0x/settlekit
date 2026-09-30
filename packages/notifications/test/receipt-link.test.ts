import { describe, expect, it } from "vitest";
import { money, type Merchant, type Payment } from "@settlekit/common";
import { renderReceiptHtml, renderReceiptText } from "../src/index.js";

const payment: Payment = {
  id: "pay_1",
  organizationId: "org_1",
  checkoutSessionId: "cs_1",
  customerId: "cus_1",
  amount: money("25"),
  network: "base",
  confirmations: 3,
  status: "confirmed",
  createdAt: "2026-09-30T00:00:00.000Z",
};
const merchant = { id: "m", organizationId: "org_1", displayName: "Acme", slug: "acme", createdAt: "2026-09-30T00:00:00.000Z" } as Merchant;

describe("receipt PDF link", () => {
  it("adds the receipt link only when given", () => {
    const url = "https://pay.test/c/cs_1/receipt";
    expect(renderReceiptHtml(payment, [], merchant, { receiptUrl: url })).toContain(`href="${url}"`);
    expect(renderReceiptText(payment, [], merchant, { receiptUrl: url })).toContain(`Receipt (PDF): ${url}`);
    expect(renderReceiptHtml(payment, [], merchant)).not.toContain("Download receipt");
  });
});
