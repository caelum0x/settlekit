import { describe, expect, it } from "vitest";
import { createInvoice, invoiceNumber } from "../src/index.js";

describe("invoices", () => {
  it("creates invoice numbers and totals", () => {
    const invoice = createInvoice({
      organizationId: "org_1",
      customerId: "cus_1",
      number: invoiceNumber("INV", 7),
      lineItems: [{ description: "Seat", quantity: 2, unitAmount: { amount: "5", currency: "USDC" } }],
    });
    expect(invoice.number).toBe("INV-000007");
    expect(invoice.total.amount).toBe("10");
  });
});
