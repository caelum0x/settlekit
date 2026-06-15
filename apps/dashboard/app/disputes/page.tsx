import { api } from "@/lib/api";
import { formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { Dispute, DisputeReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const DISPUTE_REASONS: DisputeReason[] = [
  "fraud",
  "not_received",
  "duplicate",
  "quality",
  "unrecognized",
];

function isDisputeReason(value: string): value is DisputeReason {
  return (DISPUTE_REASONS as string[]).includes(value);
}

async function openDispute(values: Record<string, string>): Promise<string | null> {
  "use server";
  const reasonRaw = (values.reason ?? "fraud").trim();
  const reason: DisputeReason = isDisputeReason(reasonRaw) ? reasonRaw : "fraud";
  const { error } = await api.disputes.open({
    paymentId: (values.paymentId ?? "").trim(),
    customerId: (values.customerId ?? "").trim(),
    reason,
  });
  return error;
}

export default async function DisputesPage() {
  const disputes = await api.disputes.list();
  return (
    <>
      <PageHeader
        title="Disputes"
        description="Chargebacks and payment disputes. Submit evidence to move a case under review, then resolve it as won, lost, or refunded."
      />
      <ErrorBanner error={disputes.error} />
      <Card title="Disputes">
        <DataTable<Dispute>
          rows={disputes.data}
          getKey={(d) => d.id}
          empty={
            <EmptyState
              title="No disputes yet"
              message="Open a dispute below when a payment is contested by a customer or the network."
            />
          }
          columns={[
            { header: "ID", cell: (d) => <span className="mono">{d.id}</span> },
            { header: "Payment", cell: (d) => <span className="mono">{d.paymentId}</span> },
            { header: "Customer", cell: (d) => <span className="mono">{d.customerId}</span> },
            { header: "Reason", cell: (d) => humanize(d.reason) },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
            { header: "Evidence", cell: (d) => String(d.evidence.length) },
            { header: "Opened", cell: (d) => formatDate(d.openedAt) },
            { header: "Resolved", align: "right", cell: (d) => formatDate(d.resolvedAt) },
          ]}
        />
      </Card>
      <Card title="Open dispute">
        <SimpleCreateForm
          submitLabel="Open dispute"
          successMessage="Dispute opened."
          action={openDispute}
          fields={[
            { name: "paymentId", label: "Payment ID", required: true, placeholder: "pay_…" },
            { name: "customerId", label: "Customer ID", required: true, placeholder: "cus_…" },
            {
              name: "reason",
              label: "Reason",
              required: true,
              options: [
                { value: "fraud", label: "Fraud" },
                { value: "not_received", label: "Not received" },
                { value: "duplicate", label: "Duplicate" },
                { value: "quality", label: "Quality" },
                { value: "unrecognized", label: "Unrecognized" },
              ],
            },
          ]}
        />
      </Card>
    </>
  );
}
