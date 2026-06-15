import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { DunningState } from "@/lib/types";

export const dynamic = "force-dynamic";

async function startDunning(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.dunning.start((values.subscriptionId ?? "").trim());
  return error;
}

export default async function DunningPage() {
  const campaigns = await api.dunning.list();
  return (
    <>
      <PageHeader
        title="Dunning"
        description="Failed-payment recovery campaigns. Each retry follows the schedule offsets until the subscription recovers or the campaign exhausts its attempts."
      />
      <ErrorBanner error={campaigns.error} />
      <Card title="Active campaigns">
        <DataTable<DunningState>
          rows={campaigns.data}
          getKey={(d) => d.subscriptionId}
          empty={
            <EmptyState
              title="No active dunning campaigns"
              message="Start a campaign below for a subscription whose latest renewal payment failed."
            />
          }
          columns={[
            { header: "Subscription", cell: (d) => <span className="mono">{d.subscriptionId}</span> },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
            {
              header: "Attempt",
              cell: (d) => `${d.attempt} / ${d.schedule.offsetsDays.length}`,
            },
            { header: "Next attempt", cell: (d) => formatDateTime(d.nextAttemptAt) },
            { header: "Started", cell: (d) => formatDate(d.startedAt) },
            { header: "Updated", align: "right", cell: (d) => formatDate(d.updatedAt) },
          ]}
        />
      </Card>
      <Card title="Start campaign">
        <SimpleCreateForm
          submitLabel="Start dunning"
          successMessage="Dunning campaign started."
          action={startDunning}
          fields={[
            {
              name: "subscriptionId",
              label: "Subscription ID",
              required: true,
              placeholder: "sub_…",
              hint: "Starts on the default schedule (retry now, +1d, +3d, +7d).",
            },
          ]}
        />
      </Card>
    </>
  );
}
