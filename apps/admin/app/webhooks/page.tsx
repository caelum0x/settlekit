import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "../components/ActionButton";
import { Pill, EmptyRow } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function WebhooksPage() {
  let events;
  try {
    events = await api.webhookEvents();
  } catch (e) {
    return (
      <>
        <h1>Webhook delivery log</h1>
        <div className="error">
          Failed to load webhook events:{" "}
          {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Webhook delivery log</h1>
      <p className="subtitle">
        Outbound webhook events. Replay re-signs the payload with @settlekit/webhooks
        and re-POSTs it to the endpoint.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Event</th>
              <th>Org</th>
              <th>Type</th>
              <th>Endpoint</th>
              <th>Delivered</th>
              <th>Attempts</th>
              <th>Last error</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 ? (
              <EmptyRow colSpan={9} text="No webhook events." />
            ) : (
              events.map((ev) => (
                <tr key={ev.id}>
                  <td className="mono">{ev.id}</td>
                  <td>
                    <Link href={`/organizations/${ev.organizationId}`}>
                      {ev.organizationId}
                    </Link>
                  </td>
                  <td className="mono">{ev.type}</td>
                  <td className="mono">{ev.endpointUrl}</td>
                  <td>
                    <Pill
                      label={ev.delivered ? "delivered" : "pending"}
                      tone={ev.delivered ? "ok" : "warn"}
                    />
                  </td>
                  <td>{ev.attempts}</td>
                  <td className="mono">{ev.lastError ?? "—"}</td>
                  <td>{formatDateTime(ev.createdAt)}</td>
                  <td>
                    <ActionButton
                      endpoint={`/api/v1/webhooks/${ev.id}/replay`}
                      label="Replay"
                      tone="warn"
                      successText="Replayed"
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
