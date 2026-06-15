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

export default async function InvoicesPage() {
  const invoices = await api.invoices.list();
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Issue itemized invoices with exact USDC totals and optional tax. View the rendered HTML invoice for any record."
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
