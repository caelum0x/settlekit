import { api } from "@/lib/api";
import { formatDateTime, formatNumber, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
  SubNav,
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
  // The API exposes no per-endpoint delivery feed, so recent delivery activity
  // is sourced from the org-wide delivery-runs stream (status + attempts).
  const [hooks, runs] = await Promise.all([
    api.webhooks.list(),
    api.delivery.runs(),
  ]);

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Receive real-time events for payments, entitlements, and delivery runs."
      />
      <SubNav
        items={[
          { label: "Endpoints", href: "#endpoints" },
          { label: "Recent deliveries", href: "#deliveries" },
        ]}
      />

      <div id="endpoints">
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
      </div>

      <div id="deliveries">
        <ErrorBanner error={runs.error} />
        <Card title="Recent deliveries">
          <p className="page-desc" style={{ marginTop: 0 }}>
            Organization-wide delivery activity with status and retry attempts.
          </p>
          <DataTable
            rows={runs.data}
            getKey={(r) => r.id}
            empty={
              <EmptyState
                title="No delivery activity"
                message="Delivery runs appear here once events are dispatched to your endpoints."
              />
            }
            columns={[
              { header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              {
                header: "Attempts",
                align: "right",
                cell: (r) => <span className="mono">{formatNumber(r.attempts)}</span>,
              },
              { header: "Action", cell: (r) => humanize(r.action) },
              {
                header: "Customer",
                cell: (r) => <span className="mono">{r.customerEmail}</span>,
              },
              { header: "Started", cell: (r) => formatDateTime(r.startedAt) },
            ]}
          />
        </Card>
      </div>

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
