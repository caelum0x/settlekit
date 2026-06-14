import { describe, expect, it } from "vitest";
import { createInvoice, invoiceNumber } from "../src/index.js";

describe("invoices", () => {
  it("creates invoice numbers and totals", () => {
    const invoice = createInvoice("cus_1", invoiceNumber("INV", 7), [{ description: "Seat", quantity: 2, unitAmount: { amount: "5", currency: "USDC" } }]);
    expect(invoice.number).toBe("INV-000007");
    expect(invoice.total.amount).toBe("10");
  });
});
