import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { GITHUB_NAV } from "../nav";

export const dynamic = "force-dynamic";

async function grantAccess(values: Record<string, string>): Promise<string | null> {
  "use server";
  const kind = values.kind === "team" ? "team" : "repo";
  const { error } = await api.github.grant(
    values.customerEmail ?? "",
    values.target ?? "",
    kind,
  );
  return error;
}

export default async function GithubAccessPage() {
  const access = await api.github.access();
  return (
    <>
      <PageHeader
        title="GitHub Access Grants"
        description="Every buyer who has been invited to a repo or team, plus manual grants."
      />
      <SubNav items={GITHUB_NAV} />
      <ErrorBanner error={access.error} />
      <Card title="Grants">
        <DataTable
          rows={access.data}
          getKey={(g) => g.id}
          empty={
            <EmptyState
              title="No access grants yet"
              message="Grants are created automatically on purchase. You can also grant access manually below."
            />
          }
          columns={[
            { header: "Customer", cell: (g) => g.customerEmail },
            { header: "Target", cell: (g) => <span className="mono">{g.target}</span> },
            { header: "Kind", cell: (g) => <span className="tag">{g.kind}</span> },
            { header: "Status", cell: (g) => <StatusBadge status={g.status} /> },
            { header: "Granted", cell: (g) => formatDateTime(g.grantedAt) },
          ]}
        />
      </Card>
      <Card title="Grant access manually">
        <SimpleCreateForm
          submitLabel="Grant access"
          successMessage="Access granted."
          action={grantAccess}
          fields={[
            { name: "customerEmail", label: "Customer email", type: "email", required: true },
            {
              name: "target",
              label: "Target",
              required: true,
              placeholder: "owner/repo or team-slug",
            },
            {
              name: "kind",
              label: "Kind",
              required: true,
              options: [
                { value: "repo", label: "Repository invite" },
                { value: "team", label: "Team membership" },
              ],
            },
          ]}
        />
      </Card>
    </>
  );
}
