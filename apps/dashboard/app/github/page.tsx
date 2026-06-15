import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  StatGrid,
  StatCard,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { GITHUB_NAV } from "./nav";

export const dynamic = "force-dynamic";

export default async function GithubPage() {
  const [installs, repos, teams, access] = await Promise.all([
    api.github.installations(),
    api.github.repositories(),
    api.github.teams(),
    api.github.access(),
  ]);

  return (
    <>
      <PageHeader
        title="GitHub Access"
        description="Sell private repos and team membership — SettleKit invites buyers automatically on purchase."
      />
      <SubNav items={GITHUB_NAV} />
      <ErrorBanner error={installs.error} />
      <StatGrid>
        <StatCard label="Installations" value={String(installs.total)} />
        <StatCard label="Repositories" value={String(repos.total)} />
        <StatCard label="Teams" value={String(teams.total)} />
        <StatCard label="Access grants" value={String(access.total)} tone="good" />
      </StatGrid>
      <Card title="Installations">
        <DataTable
          rows={installs.data}
          getKey={(i) => i.id}
          empty={
            <EmptyState
              title="GitHub App not installed"
              message="Install the SettleKit GitHub App to grant buyers repo and team access."
            />
          }
          columns={[
            { header: "Account", cell: (i) => i.account },
            {
              header: "Repository selection",
              cell: (i) => <span className="tag">{i.repositorySelection}</span>,
            },
            { header: "Installed", cell: (i) => formatDate(i.installedAt) },
          ]}
        />
      </Card>
    </>
  );
}
