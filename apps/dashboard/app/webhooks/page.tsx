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
import { revalidatePath } from "next/cache";

async function sendTest(endpointId: string): Promise<void> {
  "use server";
  await api.webhooks.test(endpointId);
  revalidatePath("/webhooks");
}

async function rotateSecret(endpointId: string): Promise<void> {
  "use server";
  await api.webhooks.rotate(endpointId, 24);
  revalidatePath("/webhooks");
}

async function setActive(endpointId: string, active: boolean): Promise<void> {
  "use server";
  await api.webhooks.setActive(endpointId, active);
  revalidatePath("/webhooks");
}

async function resend(eventId: string, endpointId: string): Promise<void> {
  "use server";
  await api.webhooks.resend(eventId, endpointId);
  revalidatePath("/webhooks");
}

export const dynamic = "force-dynamic";

/** Events SettleKit sends; the first four are what a SaaS needs to unlock paid plans. */
const EVENT_TYPES = [
  "payment.confirmed",
  "subscription.charged",
  "subscription.canceled",
  "refund.succeeded",
  "payment.refunded",
  "entitlement.granted",
  "entitlement.revoked",
  "delivery.succeeded",
  "delivery.failed",
  "invoice.paid",
] as const;
const DEFAULT_EVENTS = EVENT_TYPES.slice(0, 4).join(", ");

async function createWebhook(values: Record<string, string>): Promise<string | null> {
  "use server";
  const events = (values.events || DEFAULT_EVENTS)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = events.filter((e) => !(EVENT_TYPES as readonly string[]).includes(e));
  if (unknown.length > 0) return `Unknown event${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`;
  const { error } = await api.webhooks.create(values.url ?? "", events);
  return error;
}

export default async function WebhooksPage() {
  const [hooks, runs, deliveries] = await Promise.all([
    api.webhooks.list(),
    api.delivery.runs(),
    api.webhooks.deliveries(),
  ]);

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Signed POSTs to your server when a payment confirms, a subscription charges or cancels, or a refund is sent. Verify the SettleKit-Signature header with the endpoint's secret (see /docs/integrate on the website)."
      />
      <SubNav
        items={[
          { label: "Endpoints", href: "#endpoints" },
          { label: "Event log", href: "#event-log" },
          { label: "Access deliveries", href: "#deliveries" },
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
              {
                header: "Status",
                cell: (h) => (
                  <span>
                    <StatusBadge status={h.status} />
                    {h.disabledReason ? <span className="dim small"> {h.disabledReason}</span> : null}
                  </span>
                ),
              },
              {
                header: "Signing secret",
                cell: (h) => (
                  <details>
                    <summary className="muted">Reveal</summary>
                    <code className="mono">{h.signingSecret}</code>
                  </details>
                ),
              },
              {
                header: "",
                cell: (h) => (
                  <div style={{ display: "flex", gap: 6 }}>
                    <form action={sendTest.bind(null, h.id)}>
                      <button type="submit" className="btn btn-small">
                        Send test
                      </button>
                    </form>
                    <form action={rotateSecret.bind(null, h.id)}>
                      <button type="submit" className="btn btn-small" title="The old secret keeps working for 24 hours">
                        Rotate secret
                      </button>
                    </form>
                    <form action={setActive.bind(null, h.id, h.status !== "enabled")}>
                      <button type="submit" className="btn btn-small">
                        {h.status === "enabled" ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <div id="event-log">
        <ErrorBanner error={deliveries.error} />
        <Card title="Event log">
          <p className="page-desc" style={{ marginTop: 0 }}>
            Every event sent to your endpoints with its response code. Failed deliveries retry with backoff; resend any
            event after you fix your server.
          </p>
          <DataTable
            rows={deliveries.data}
            getKey={(d) => d.id}
            empty={<EmptyState title="No events yet" message="Send a test event to check your endpoint." />}
            columns={[
              { header: "Event", cell: (d) => <span className="mono">{d.eventType}</span> },
              { header: "Endpoint", cell: (d) => <span className="mono">{d.url}</span> },
              { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
              {
                header: "Response",
                cell: (d) =>
                  d.lastStatus === null ? (
                    <span className="dim">-</span>
                  ) : (
                    <span className="mono" title={d.lastError ?? ""}>
                      {d.lastStatus === 0 ? "no response" : d.lastStatus}
                    </span>
                  ),
              },
              { header: "Attempts", align: "right", cell: (d) => <span className="mono">{formatNumber(d.attempts)}</span> },
              {
                header: "Next retry",
                cell: (d) => (d.status === "delivered" ? "-" : d.nextAttemptAt ? formatDateTime(d.nextAttemptAt) : "stopped"),
              },
              { header: "Last attempt", cell: (d) => (d.lastAttemptAt ? formatDateTime(d.lastAttemptAt) : "-") },
              {
                header: "",
                cell: (d) => (
                  <form action={resend.bind(null, d.eventId, d.endpointId)}>
                    <button type="submit" className="btn btn-small">
                      Resend
                    </button>
                  </form>
                ),
              },
            ]}
          />
        </Card>
      </div>

      <div id="deliveries">
        <ErrorBanner error={runs.error} />
        <Card title="Access deliveries">
          <p className="page-desc" style={{ marginTop: 0 }}>
            Access delivery runs (GitHub, Discord, license keys) with status and retry attempts.
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
              placeholder: DEFAULT_EVENTS,
              hint: `Comma-separated. Leave empty for ${DEFAULT_EVENTS}. Also available: ${EVENT_TYPES.slice(4).join(", ")}.`,
            },
          ]}
        />
      </Card>
    </>
  );
}
