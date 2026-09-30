import { describe, expect, it } from "vitest";
import { money, type Payment } from "@settlekit/common";
import type { WebhookEmitInput, WebhookOutbox } from "@settlekit/persistence";
import type { InvoiceStoreLike, JobContext } from "../src/jobs/types.js";
import { invoiceSettleJob } from "../src/jobs/invoice-settle-job.js";
import { allJobs, workerJobs } from "../src/jobs/index.js";

type StoredInvoice = Awaited<ReturnType<InvoiceStoreLike["save"]>>;

function memoryInvoices(seed: StoredInvoice[]): InvoiceStoreLike & { all: Map<string, StoredInvoice> } {
  const all = new Map(seed.map((inv) => [inv.id, inv]));
  return {
    all,
    async save(inv) {
      all.set(inv.id, inv);
      return inv;
    },
    async findById(id) {
      return all.get(id) ?? null;
    },
    async list(predicate) {
      const rows = [...all.values()];
      return predicate ? rows.filter(predicate) : rows;
    },
  };
}

function invoice(over: Partial<StoredInvoice>): StoredInvoice {
  return {
    id: "inv_1",
    number: "INV-000001",
    organizationId: "org_1",
    customerId: "cus_1",
    lineItems: [{ description: "Work", quantity: 1, unitAmount: money("40") }],
    subtotal: money("40"),
    total: money("40"),
    currency: "USDC",
    status: "open",
    issuedAt: "2026-09-01T00:00:00.000Z",
    metadata: { payToken: "tok_abcdefghijklmnopqrstu", checkoutSessionIds: "cs_1" },
    ...over,
  };
}

function payment(over: Partial<Payment>): Payment {
  return {
    id: "pay_1",
    organizationId: "org_1",
    checkoutSessionId: "cs_1",
    customerId: "cus_1",
    amount: money("40"),
    network: "base",
    txHash: "0xabc",
    confirmations: 3,
    status: "confirmed",
    createdAt: "2026-09-02T00:00:00.000Z",
    confirmedAt: "2026-09-02T00:01:00.000Z",
    ...over,
  };
}

function ctxWith(invoices: InvoiceStoreLike | undefined, payments: Payment[], outbox?: WebhookOutbox): JobContext {
  return {
    ...(invoices ? { invoices } : {}),
    ...(outbox ? { webhooks: outbox } : {}),
    stores: { confirmedPayments: async () => payments },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => new Date("2026-09-03T00:00:00.000Z"),
  } as unknown as JobContext;
}

describe("invoiceSettleJob", () => {
  it("is registered with the worker", () => {
    expect(workerJobs).toContain("invoice-settle");
    expect(allJobs().map((job) => job.name)).toContain("invoice-settle");
  });

  it("no-ops without an invoice store", async () => {
    expect(await invoiceSettleJob.run(ctxWith(undefined, [payment({})]))).toEqual({ processed: 0, failed: 0 });
  });

  it("settles a sent invoice from a confirmed session payment and queues invoice.paid", async () => {
    const store = memoryInvoices([invoice({}), invoice({ id: "inv_2", metadata: { checkoutSessionIds: "cs_9" } })]);
    const emitted: WebhookEmitInput[] = [];
    const outbox: WebhookOutbox = {
      async enqueue(input) {
        emitted.push(input);
        return { eventId: "evt_1", queued: 1, duplicate: false };
      },
    };
    const result = await invoiceSettleJob.run(ctxWith(store, [payment({})], outbox));
    expect(result).toEqual({ processed: 1, failed: 0 });
    const settled = store.all.get("inv_1")!;
    expect(settled.status).toBe("paid");
    expect(settled.paidAt).toBe("2026-09-02T00:01:00.000Z");
    expect(settled.metadata.paidTxHash).toBe("0xabc");
    expect(store.all.get("inv_2")!.status).toBe("open");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ type: "invoice.paid", key: "inv_1", data: { txHash: "0xabc", amount: "40" } });

    // Idempotent: a second tick finds nothing open to settle.
    expect(await invoiceSettleJob.run(ctxWith(store, [payment({})], outbox))).toEqual({ processed: 0, failed: 0 });
  });

  it("never settles from a short or pending payment", async () => {
    const store = memoryInvoices([invoice({})]);
    await invoiceSettleJob.run(ctxWith(store, [payment({ amount: money("39.99") }), payment({ id: "p2", status: "pending" })]));
    expect(store.all.get("inv_1")!.status).toBe("open");
  });
});
