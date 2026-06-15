import { api } from "@/lib/api";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { DISCORD_NAV } from "../nav";

export const dynamic = "force-dynamic";

export default async function DiscordRolesPage() {
  const roles = await api.discord.roles();
  return (
    <>
      <PageHeader
        title="Discord Roles"
        description="Roles you can attach to a product's delivery action."
      />
      <SubNav items={DISCORD_NAV} />
      <ErrorBanner error={roles.error} />
      <Card>
        <DataTable
          rows={roles.data}
          getKey={(r) => r.id}
          empty={
            <EmptyState
              title="No roles found"
              message="Connect a server to load its assignable roles."
            />
          }
          columns={[
            {
              header: "Role",
              cell: (r) => (
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: r.color || "var(--text-dim)",
                      marginRight: 8,
                    }}
                  />
                  {r.name}
                </span>
              ),
            },
            { header: "Server", cell: (r) => r.serverName },
            { header: "Role ID", cell: (r) => <span className="mono">{r.id}</span> },
          ]}
        />
      </Card>
    </>
  );
}
