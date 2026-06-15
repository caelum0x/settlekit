import { api } from "@/lib/api";
import { formatNumber } from "@/lib/format";
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

export default async function GithubTeamsPage() {
  const teams = await api.github.teams();
  return (
    <>
      <PageHeader
        title="Teams"
        description="GitHub organization teams buyers can be added to on purchase."
      />
      <SubNav items={GITHUB_NAV} />
      <ErrorBanner error={teams.error} />
      <Card>
        <DataTable
          rows={teams.data}
          getKey={(t) => t.id}
          empty={
            <EmptyState
              title="No teams"
              message="Connect an organization installation to manage team-based access."
            />
          }
          columns={[
            { header: "Team", cell: (t) => t.name },
            { header: "Slug", cell: (t) => <span className="mono">{t.slug}</span> },
            { header: "Members", cell: (t) => formatNumber(t.memberCount) },
          ]}
        />
      </Card>
    </>
  );
}
