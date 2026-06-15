import { api, API_URL } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { GITHUB_NAV } from "../nav";

export const dynamic = "force-dynamic";

export default async function GithubInstallPage() {
  const installs = await api.github.installations();
  return (
    <>
      <PageHeader
        title="Install GitHub App"
        description="Connect a GitHub account or organization so SettleKit can manage access."
      />
      <SubNav items={GITHUB_NAV} />
      <ErrorBanner error={installs.error} />
      <Card title="Connect">
        <p className="muted">
          The SettleKit GitHub App needs repository and organization permissions
          to invite buyers and manage team membership.
        </p>
        <div style={{ marginTop: 14 }}>
          <a
            className="btn btn-primary"
            href={`${API_URL}/v1/integrations/github/installations/new`}
          >
            Install GitHub App
          </a>
        </div>
      </Card>
      <Card title="Existing installations">
        <DataTable
          rows={installs.data}
          getKey={(i) => i.id}
          empty={
            <EmptyState
              title="No installations"
              message="After installing, your connected accounts will be listed here."
            />
          }
          columns={[
            { header: "Account", cell: (i) => i.account },
            { header: "Scope", cell: (i) => <span className="tag">{i.repositorySelection}</span> },
            { header: "Installed", cell: (i) => formatDate(i.installedAt) },
          ]}
        />
      </Card>
    </>
  );
}
