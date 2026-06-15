import {
  entitlementsOfType,
  loadCustomerScope,
} from "@/lib/load";
import type { Entitlement } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { RecheckAccessButton } from "@/components/RecheckAccessButton";
import { featureString, formatDate, humanize } from "@/lib/format";

/**
 * Access page: GitHub repo / team access and Discord roles granted to the
 * customer, read from their entitlements. The org's GitHub access can be
 * reconciled live with the Re-check button (promotes accepted invites).
 */
export default async function AccessPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, productNames, customer, error } =
    await loadCustomerScope(customerId);

  const github = entitlementsOfType(entitlements, [
    "github_repo_access",
    "github_team_access",
  ]);
  const discord = entitlementsOfType(entitlements, ["discord_role"]);

  const organizationId =
    customer?.organizationId ?? entitlements[0]?.organizationId ?? "";

  function targetOf(e: Entitlement): string {
    return (
      featureString(e.features, "repo") ??
      featureString(e.features, "target") ??
      e.resourceId ??
      "—"
    );
  }

  const githubColumns: Column<Entitlement>[] = [
    { key: "type", header: "Type", render: (e) => humanize(e.entitlementType) },
    {
      key: "repo",
      header: "Repository / Team",
      render: (e) => <span className="mono">{targetOf(e)}</span>,
    },
    {
      key: "product",
      header: "Product",
      render: (e) => productNames.get(e.productId) ?? e.productId,
    },
    { key: "granted", header: "Granted", render: (e) => formatDate(e.createdAt) },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (e) => <StatusBadge status={e.status} />,
    },
  ];

  const discordColumns: Column<Entitlement>[] = [
    {
      key: "role",
      header: "Role",
      render: (e) =>
        featureString(e.features, "roleName") ?? (
          <span className="mono">{e.resourceId ?? "—"}</span>
        ),
    },
    {
      key: "server",
      header: "Server",
      render: (e) =>
        featureString(e.features, "guildName") ?? <span className="muted">—</span>,
    },
    {
      key: "product",
      header: "Product",
      render: (e) => productNames.get(e.productId) ?? e.productId,
    },
    { key: "granted", header: "Granted", render: (e) => formatDate(e.createdAt) },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (e) => <StatusBadge status={e.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Access"
        description="GitHub repositories and Discord roles unlocked by your purchases."
        actions={<RecheckAccessButton organizationId={organizationId} />}
      />
      {error ? <ErrorNote message={error} /> : null}

      <section className="section">
        <h2 className="section-title">GitHub access</h2>
        <DataTable
          columns={githubColumns}
          rows={github}
          rowKey={(e) => e.id}
          emptyTitle="No GitHub access"
          emptyBody="Repositories and teams you've been added to will appear here. Re-check after accepting an invite."
        />
      </section>

      <section className="section">
        <h2 className="section-title">Discord roles</h2>
        <DataTable
          columns={discordColumns}
          rows={discord}
          rowKey={(e) => e.id}
          emptyTitle="No Discord roles"
          emptyBody="Paid Discord roles assigned to your account will appear here."
        />
      </section>
    </div>
  );
}
