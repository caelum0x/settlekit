import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "../components/ActionButton";
import { Badge, EmptyRow } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage() {
  let runs;
  try {
    runs = await api.failedDeliveries();
  } catch (e) {
    return (
      <>
        <h1>Failed deliveries</h1>
        <div className="error">
          Failed to load delivery runs:{" "}
          {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Failed deliveries</h1>
      <p className="subtitle">
        Delivery runs that exhausted their retries. Retrying re-runs the failed
        actions and grants access if they succeed.
      </p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Org</th>
              <th>Payment</th>
              <th>Attempts</th>
              <th>Failed actions</th>
              <th>Last error</th>
              <th>Updated</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <EmptyRow colSpan={8} text="No failed delivery runs. 🎉" />
            ) : (
              runs.map((r) => {
                const failedActions = r.actionRuns
                  .filter((a) => a.status !== "succeeded")
                  .map((a) => a.actionId)
                  .join(", ");
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.id}</td>
                    <td>
                      <Link href={`/organizations/${r.organizationId}`}>
                        {r.organizationId}
                      </Link>
                    </td>
                    <td className="mono">{r.paymentId ?? "—"}</td>
                    <td>{r.attempt}</td>
                    <td className="mono">{failedActions || "—"}</td>
                    <td className="mono">{r.lastError ?? "—"}</td>
                    <td>{formatDateTime(r.updatedAt)}</td>
                    <td>
                      <Badge label={r.status} />{" "}
                      <ActionButton
                        endpoint={`/api/v1/delivery-runs/${r.id}/retry`}
                        label="Retry"
                        tone="warn"
                        successText="Retried"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
