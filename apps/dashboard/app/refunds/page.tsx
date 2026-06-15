import { api } from "@/lib/api";
import { formatMoneyDecimal, formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { Refund, RefundReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const REFUND_REASONS: RefundReason[] = [
  "duplicate",
  "fraudulent",
  "customer_request",
  "delivery_failed",
];

function isRefundReason(value: string): value is RefundReason {
  return (REFUND_REASONS as string[]).includes(value);
}

async function createRefund(values: Record<string, string>): Promise<string | null> {
  "use server";
  const reasonRaw = (values.reason ?? "customer_request").trim();
  const reason: RefundReason = isRefundReason(reasonRaw) ? reasonRaw : "customer_request";
  const { error } = await api.refunds.create({
    paymentId: (values.paymentId ?? "").trim(),
    customerId: (values.customerId ?? "").trim(),
    amount: (values.amount ?? "").trim(),
    reason,
  });
  return error;
}

export default async function RefundsPage() {
  const refunds = await api.refunds.list();
  return (
    <>
      <PageHeader
        title="Refunds"
        description="Issue partial or full refunds against confirmed payments. Aggregate refunds can never exceed the original payment amount."
      />
      <ErrorBanner error={refunds.error} />
      <Card title="Refunds">
        <DataTable<Refund>
          rows={refunds.data}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="No refunds yet"
              message="Create a pending refund below; mark it succeeded once the on-chain transfer settles."
            />
          }
          columns={[
            { header: "ID", cell: (r) => <span className="mono">{r.id}</span> },
            { header: "Payment", cell: (r) => <span className="mono">{r.paymentId}</span> },
            { header: "Customer", cell: (r) => <span className="mono">{r.customerId}</span> },
            { header: "Reason", cell: (r) => humanize(r.reason) },
            { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "Created", cell: (r) => formatDate(r.createdAt) },
            { header: "Amount", align: "right", cell: (r) => formatMoneyDecimal(r.amount) },
          ]}
        />
      </Card>
      <Card title="Create refund">
        <SimpleCreateForm
          submitLabel="Create refund"
          successMessage="Refund created."
          action={createRefund}
          fields={[
            { name: "paymentId", label: "Payment ID", required: true, placeholder: "pay_…" },
            { name: "customerId", label: "Customer ID", required: true, placeholder: "cus_…" },
            {
              name: "amount",
              label: "Amount (USDC)",
              required: true,
              placeholder: "25.00",
              hint: "Decimal USDC. Must not exceed the payment's refundable remaining.",
            },
            {
              name: "reason",
              label: "Reason",
              required: true,
              options: [
                { value: "customer_request", label: "Customer request" },
                { value: "duplicate", label: "Duplicate" },
                { value: "fraudulent", label: "Fraudulent" },
                { value: "delivery_failed", label: "Delivery failed" },
              ],
            },
          ]}
        />
      </Card>
    </>
  );
}
