import Link from "next/link";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Badge, EmptyRow } from "../components/ui";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  let orgs;
  try {
    orgs = await api.organizations();
  } catch (e) {
    return (
      <>
        <h1>Organizations</h1>
        <div className="error">
          Failed to load organizations:{" "}
          {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Organizations</h1>
      <p className="subtitle">Every tenant on the platform.</p>

      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Created</th>
              <th>ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orgs.length === 0 ? (
              <EmptyRow colSpan={6} text="No organizations." />
            ) : (
              orgs.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/organizations/${o.id}`}>{o.name}</Link>
                  </td>
                  <td className="mono">{o.slug}</td>
                  <td>
                    <Badge label={o.status} />
                  </td>
                  <td>{formatDateTime(o.createdAt)}</td>
                  <td className="mono">{o.id}</td>
                  <td className="actions">
                    <Link href={`/organizations/${o.id}`}>Inspect →</Link>
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
