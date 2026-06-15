import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/format";
import { ActionButton } from "../../components/ActionButton";
import { Badge, EmptyRow } from "../../components/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let detail;
  try {
    detail = await api.organization(params.id);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    if (message.includes("not found")) notFound();
    return (
      <>
        <h1>Organization</h1>
        <div className="error">Failed to load organization: {message}</div>
      </>
    );
  }

  const { organization, payments, entitlements, deliveryRuns } = detail;

  return (
    <>
      <p className="subtitle">
        <Link href="/organizations">← Organizations</Link>
      </p>
      <h1>{organization.name}</h1>
      <p className="subtitle">
        <Badge label={organization.status} />{" "}
        <span className="mono">{organization.slug}</span> · created{" "}
        {formatDateTime(organization.createdAt)} ·{" "}
        <span className="mono">{organization.id}</span>
      </p>

      <h2>Payments</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Network</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <EmptyRow colSpan={6} text="No payments." />
            ) : (
              payments.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.id}</td>
                  <td className="mono">{p.customerId ?? "—"}</td>
                  <td>{formatMoney(p.amount)}</td>
                  <td>{p.network}</td>
                  <td>
                    <Badge label={p.status} />
                  </td>
                  <td>{formatDateTime(p.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2>Entitlements</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Customer</th>
              <th>Type</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {entitlements.length === 0 ? (
              <EmptyRow colSpan={5} text="No entitlements." />
            ) : (
              entitlements.map((ent) => (
                <tr key={ent.id}>
                  <td className="mono">{ent.id}</td>
                  <td className="mono">{ent.customerId}</td>
                  <td>{ent.type}</td>
                  <td>
                    <Badge label={ent.status} />
                  </td>
                  <td>{formatDateTime(ent.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2>Delivery runs</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Attempt</th>
              <th>Last error</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {deliveryRuns.length === 0 ? (
              <EmptyRow colSpan={6} text="No delivery runs." />
            ) : (
              deliveryRuns.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>
                    <Badge label={r.status} />
                  </td>
                  <td>{r.attempt}</td>
                  <td className="mono">{r.lastError ?? "—"}</td>
                  <td>{formatDateTime(r.updatedAt)}</td>
                  <td className="actions">
                    {r.status === "failed" ? (
                      <ActionButton
                        endpoint={`/api/v1/delivery-runs/${r.id}/retry`}
                        label="Retry"
                        tone="warn"
                        successText="Retried"
                      />
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
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
