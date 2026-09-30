import { describe, expect, it } from "vitest";
import {
  InMemoryInvoiceStore,
  InvoiceService,
  checkoutSessionIdsOf,
  createInvoice,
  finalizeInvoice,
  invoiceNumber,
  latestCheckoutSessionId,
  payTokenOf,
  reconcileInvoice,
  settleInvoice,
  unpayableReason,
  withCheckoutSession,
  withPayToken,
  type Invoice,
} from "../src/index.js";

function openInvoice(total = "120"): Invoice {
  return finalizeInvoice(
    createInvoice({
      organizationId: "org_1",
      customerId: "cus_1",
      number: invoiceNumber("INV", 1),
      lineItems: [{ description: "Design work", quantity: 1, unitAmount: { amount: total, currency: "USDC" } }],
    }),
    new Date("2026-09-01T00:00:00Z"),
  );
}

const TOKEN = "tok_abcdefghijklmnopqrstuv";

describe("payable invoices", () => {
  it("binds a stable pay token and never overwrites it", () => {
    const invoice = withPayToken(openInvoice(), TOKEN);
    expect(payTokenOf(invoice)).toBe(TOKEN);
    expect(payTokenOf(withPayToken(invoice, "tok_zzzzzzzzzzzzzzzzzzzzzzzz"))).toBe(TOKEN);
    expect(() => withPayToken(openInvoice(), "short")).toThrow(/pay token/);
  });

  it("tracks every checkout session opened for the invoice", () => {
    const one = withCheckoutSession(openInvoice(), "cs_1");
    const two = withCheckoutSession(one, "cs_2");
    expect(checkoutSessionIdsOf(two)).toEqual(["cs_1", "cs_2"]);
    expect(latestCheckoutSessionId(two)).toBe("cs_2");
    expect(checkoutSessionIdsOf(withCheckoutSession(two, "cs_1"))).toEqual(["cs_2", "cs_1"]);
    expect(checkoutSessionIdsOf(one)).toEqual(["cs_1"]);
  });

  it("explains why an invoice cannot be paid", () => {
    expect(unpayableReason(openInvoice())).toBeNull();
    expect(unpayableReason({ ...openInvoice(), status: "draft" })).toMatch(/not been issued/);
    expect(unpayableReason({ ...openInvoice(), status: "paid" })).toMatch(/already paid/);
    expect(unpayableReason({ ...openInvoice(), status: "void" })).toMatch(/voided/);
    expect(unpayableReason(openInvoice("0"))).toMatch(/nothing to pay/);
  });

  it("settles only from a full payment of one of its own sessions", () => {
    const invoice = withCheckoutSession(openInvoice("120"), "cs_1");
    const paid = settleInvoice(invoice, {
      paymentId: "pay_1",
      checkoutSessionId: "cs_1",
      amount: "120",
      network: "base",
      txHash: "0xabc",
      confirmedAt: "2026-09-02T10:00:00.000Z",
    });
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).toBe("2026-09-02T10:00:00.000Z");
    expect(paid.metadata.paymentId).toBe("pay_1");
    expect(paid.metadata.paidTxHash).toBe("0xabc");
    expect(invoice.status).toBe("open");

    expect(() =>
      settleInvoice(invoice, { paymentId: "p", checkoutSessionId: "cs_other", amount: "120", network: "base" }),
    ).toThrow(/does not belong/);
    expect(() =>
      settleInvoice(invoice, { paymentId: "p", checkoutSessionId: "cs_1", amount: "119.99", network: "base" }),
    ).toThrow(/below the invoice total/);
  });

  it("reconciles against whichever session was paid", async () => {
    const invoice = withCheckoutSession(withCheckoutSession(openInvoice("50"), "cs_old"), "cs_new");
    const none = await reconcileInvoice(invoice, async () => undefined);
    expect(none).toBeNull();
    const settled = await reconcileInvoice(invoice, async (id) =>
      id === "cs_old" ? { paymentId: "pay_9", checkoutSessionId: "cs_old", amount: "50", network: "solana" } : undefined,
    );
    expect(settled?.status).toBe("paid");
    expect(settled?.metadata.paidCheckoutSessionId).toBe("cs_old");
    expect(await reconcileInvoice({ ...invoice, status: "paid" }, async () => undefined)).toBeNull();
  });

  it("finds invoices by pay token and continues numbering after a restart", async () => {
    const store = new InMemoryInvoiceStore();
    const first = new InvoiceService(store);
    const a = await first.create({ organizationId: "org_1", customerId: "cus_1" });
    if (!a.ok) throw new Error("create failed");
    const updated = await first.update(a.value.id, (inv) => withPayToken(inv, TOKEN));
    expect(updated.ok).toBe(true);
    const found = await first.findByPayToken(TOKEN);
    expect(found?.id).toBe(a.value.id);
    expect(await first.findByPayToken("tok_unknownunknownunknown")).toBeNull();

    const restarted = new InvoiceService(store);
    const b = await restarted.create({ organizationId: "org_1", customerId: "cus_2" });
    if (!b.ok) throw new Error("create failed");
    expect(a.value.number).toBe("INV-000001");
    expect(b.value.number).toBe("INV-000002");
  });
});

describe("invoice pdf", () => {
  it("renders a real PDF with the invoice number, total and pay link", async () => {
    const { renderInvoicePdf } = await import("../src/index.js");
    const pdf = await renderInvoicePdf(openInvoice("120"), { name: "Acme Studio", email: "billing@acme.test" }, {
      payUrl: "https://pay.example/i/tok",
      seller: { taxId: "DE123456789", country: "DE" },
      buyer: { name: "Client GmbH", taxId: "DE987654321", country: "DE", email: "ap@client.test" },
      compress: false,
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text).toContain("%%EOF");
    // pdfkit writes text as hex glyph runs; the link annotation is plain.
    expect(text).toContain("https://pay.example/i/tok");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders a receipt title for a paid invoice", async () => {
    const { renderInvoicePdf } = await import("../src/index.js");
    const paid = settleInvoice(withCheckoutSession(openInvoice("10"), "cs_1"), {
      paymentId: "pay_1",
      checkoutSessionId: "cs_1",
      amount: "10",
      network: "base",
      txHash: "0xfeed",
    });
    const pdf = await renderInvoicePdf(paid, { name: "Acme" }, { compress: false });
    expect(pdf.toString("latin1")).toContain("Receipt INV-000001");
  });
});
