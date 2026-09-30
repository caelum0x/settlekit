import { afterEach, describe, expect, it, vi } from "vitest";
import type { Payment, Product } from "@settlekit/common";

import { materializeDelivery } from "../lib/deliver";
import { InvoiceLinkError, getInvoice, isInvoiceToken, startInvoicePayment } from "../lib/invoice-link";

const TOKEN = "tok_abcdefghijklmnopqrstuvwx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("invoice pay links", () => {
  it("rejects malformed tokens before calling the API", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(isInvoiceToken("short")).toBe(false);
    expect(isInvoiceToken("../../v1/admin/abcdefghij")).toBe(false);
    await expect(getInvoice("bad token")).rejects.toBeInstanceOf(InvoiceLinkError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads the invoice view and opens a session through the public API", async () => {
    process.env.SETTLEKIT_API_URL = "https://api.test/";
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      const body = url.endsWith("/sessions") ? { data: { sessionId: "cs_1" } } : { data: { number: "INV-000001", total: "10" } };
      return new Response(JSON.stringify(body), { status: url.endsWith("/sessions") ? 201 : 200 });
    });
    expect((await getInvoice(TOKEN)).number).toBe("INV-000001");
    expect(await startInvoicePayment(TOKEN)).toBe("cs_1");
    expect(calls).toEqual([
      { url: `https://api.test/v1/public/invoices/${TOKEN}`, method: "GET" },
      { url: `https://api.test/v1/public/invoices/${TOKEN}/sessions`, method: "POST" },
    ]);
  });

  it("surfaces the API status and message", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { message: "This invoice link does not exist" } }), { status: 404 }));
    const error = await getInvoice(TOKEN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvoiceLinkError);
    expect((error as InvoiceLinkError).status).toBe(404);
  });

  it("shows a paid invoice as settled, not as an access grant", () => {
    const product = {
      id: "prod_1",
      name: "Invoice INV-000001",
      metadata: { kind: "invoice", invoiceId: "inv_1" },
    } as unknown as Product;
    const payment = { id: "pay_1", organizationId: "org_1", customerId: "cus_1" } as unknown as Payment;
    const [view] = materializeDelivery(payment, { type: "email_send", template: "invoice_paid" }, product, {});
    expect(view).toMatchObject({ title: "Invoice INV-000001", value: "Paid", isLink: false });
  });
});
