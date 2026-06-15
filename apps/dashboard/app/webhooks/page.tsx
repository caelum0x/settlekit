import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

async function createWebhook(values: Record<string, string>): Promise<string | null> {
  "use server";
  const events = (values.events ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { error } = await api.webhooks.create(values.url ?? "", events);
  return error;
}

export default async function WebhooksPage() {
  const hooks = await api.webhooks.list();
  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Receive real-time events for payments, entitlements, and delivery runs."
      />
      <ErrorBanner error={hooks.error} />
      <Card title="Endpoints">
        <DataTable
          rows={hooks.data}
          getKey={(h) => h.id}
          empty={
            <EmptyState
              title="No webhook endpoints"
              message="Add an endpoint below to receive event notifications at your server."
            />
          }
          columns={[
            { header: "URL", cell: (h) => <span className="mono">{h.url}</span> },
            {
              header: "Events",
              cell: (h) => (
                <div className="tag-list">
                  {h.events.map((e) => (
                    <span className="tag" key={e}>
                      {e}
                    </span>
                  ))}
                </div>
              ),
            },
            { header: "Status", cell: (h) => <StatusBadge status={h.status} /> },
            {
              header: "Last delivery",
              cell: (h) =>
                h.lastDeliveryAt ? formatDateTime(h.lastDeliveryAt) : "—",
            },
          ]}
        />
      </Card>
      <Card title="Add endpoint">
        <SimpleCreateForm
          submitLabel="Add endpoint"
          successMessage="Webhook endpoint added."
          action={createWebhook}
          fields={[
            {
              name: "url",
              label: "Endpoint URL",
              type: "url",
              required: true,
              placeholder: "https://example.com/webhooks/settlekit",
            },
            {
              name: "events",
              label: "Events",
              placeholder: "payment.succeeded, delivery.failed",
              hint: "Comma-separated event names.",
            },
          ]}
        />
      </Card>
    </>
  );
}
