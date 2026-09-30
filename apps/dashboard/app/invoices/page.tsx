import { api } from "@/lib/api";
import { formatMoneyDecimal, formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { Invoice } from "@/lib/types";
import { revalidatePath } from "next/cache";
import { invoicePayUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

async function createInvoice(values: Record<string, string>): Promise<string | null> {
  "use server";
  const lineItems =
    values.description && values.unitAmount
      ? [
          {
            description: values.description,
            quantity: Number(values.quantity || "1"),
            unitAmount: values.unitAmount.trim(),
          },
        ]
      : undefined;
  const { error } = await api.invoices.create({
    organizationId: values.organizationId ?? "",
    customerId: values.customerId ?? "",
    ...(lineItems ? { lineItems } : {}),
  });
  return error;
}

async function requestPayment(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.invoices.request({
    amount: (values.amount ?? "").trim(),
    description: (values.description ?? "").trim(),
    payerEmail: (values.payerEmail ?? "").trim(),
    ...(values.dueDate ? { dueAt: new Date(`${values.dueDate}T23:59:59Z`).toISOString() } : {}),
  });
  return error;
}

async function sendInvoice(id: string): Promise<void> {
  "use server";
  await api.invoices.send(id);
  revalidatePath("/invoices");
}

function PayLink({ invoice }: { invoice: Invoice }) {
  const token = invoice.metadata.payToken;
  if (token) {
    return (
      <a className="mono" href={invoicePayUrl(token)} target="_blank" rel="noreferrer">
        Pay page
      </a>
    );
  }
  if (invoice.status !== "draft" && invoice.status !== "open") return <span className="muted">-</span>;
  return (
    <form action={sendInvoice.bind(null, invoice.id)}>
      <button type="submit" className="btn btn-small">
        Send
      </button>
    </form>
  );
}

export default async function InvoicesPage() {
  const invoices = await api.invoices.list();
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Bill a client in USDC: send an invoice or a quick payment request, the client pays onchain from the link, and the status turns paid on its own."
      />
      <ErrorBanner error={invoices.error} />
      <Card title="Invoices">
        <DataTable<Invoice>
          rows={invoices.data}
          getKey={(i) => i.id}
          empty={
            <EmptyState
              title="No invoices yet"
              message="Create a draft invoice below, then finalize it to issue it to a customer."
            />
          }
          columns={[
            { header: "Number", cell: (i) => <span className="mono">{i.number}</span> },
            { header: "Customer", cell: (i) => i.customerId },
            { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
            { header: "Issued", cell: (i) => formatDate(i.issuedAt) },
            { header: "Tax", cell: (i) => formatMoneyDecimal(i.tax) },
            { header: "Total", align: "right", cell: (i) => formatMoneyDecimal(i.total) },
            { header: "Pay link", cell: (i) => <PayLink invoice={i} /> },
            {
              header: "PDF",
              cell: (i) => (
                <a className="mono" href={`/invoices/${encodeURIComponent(i.id)}/pdf`} target="_blank" rel="noreferrer">
                  {i.status === "paid" ? "Receipt" : "Invoice"}
                </a>
              ),
            },
            {
              header: "View",
              cell: (i) => (
                <a
                  className="mono"
                  href={api.invoices.htmlUrl(i.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  HTML ↗
                </a>
              ),
            },
          ]}
        />
      </Card>
      <Card title="Request a payment">
        <SimpleCreateForm
          submitLabel="Send request"
          successMessage="Request sent. The pay link is in the table above."
          action={requestPayment}
          fields={[
            { name: "amount", label: "Amount (USDC)", required: true, placeholder: "250.00" },
            { name: "description", label: "What it is for", required: true, placeholder: "Website redesign, deposit" },
            { name: "payerEmail", label: "Client email", type: "email", required: true, placeholder: "billing@client.com" },
            { name: "dueDate", label: "Due date (optional)", placeholder: "2026-10-31", hint: "YYYY-MM-DD" },
          ]}
        />
      </Card>
      <Card title="Create invoice">
        <SimpleCreateForm
          submitLabel="Create draft"
          successMessage="Draft invoice created."
          action={createInvoice}
          fields={[
            { name: "organizationId", label: "Organization ID", required: true, placeholder: "org_…" },
            { name: "customerId", label: "Customer ID", required: true, placeholder: "cus_…" },
            { name: "description", label: "Line item description", placeholder: "Pro plan (annual)" },
            { name: "quantity", label: "Quantity", type: "number", placeholder: "1" },
            {
              name: "unitAmount",
              label: "Unit amount (USDC)",
              placeholder: "25.00",
              hint: "Decimal USDC. Add a description + amount to seed the first line item.",
            },
          ]}
        />
      </Card>
    </>
  );
}
