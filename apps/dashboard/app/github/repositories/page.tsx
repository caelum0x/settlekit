import { api } from "@/lib/api";
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

export default async function GithubRepositoriesPage() {
  const repos = await api.github.repositories();
  return (
    <>
      <PageHeader
        title="Repositories"
        description="Private repositories available to sell or grant access to."
      />
      <SubNav items={GITHUB_NAV} />
      <ErrorBanner error={repos.error} />
      <Card>
        <DataTable
          rows={repos.data}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="No repositories"
              message="Install the GitHub App and grant access to the repositories you want to sell."
            />
          }
          columns={[
            { header: "Repository", cell: (r) => <span className="mono">{r.fullName}</span> },
            {
              header: "Visibility",
              cell: (r) => (
                <span className="tag">{r.private ? "Private" : "Public"}</span>
              ),
            },
            { header: "Default branch", cell: (r) => <span className="tag">{r.defaultBranch}</span> },
          ]}
        />
      </Card>
    </>
  );
}
