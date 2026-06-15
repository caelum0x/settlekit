import { api } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
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
import { DISCORD_NAV } from "./nav";

export const dynamic = "force-dynamic";

export default async function DiscordPage() {
  const [servers, roles, access] = await Promise.all([
    api.discord.servers(),
    api.discord.roles(),
    api.discord.access(),
  ]);
  return (
    <>
      <PageHeader
        title="Discord Access"
        description="Sell community access — paid members get their role assigned automatically."
      />
      <SubNav items={DISCORD_NAV} />
      <ErrorBanner error={servers.error} />
      <StatGrid>
        <StatCard label="Servers" value={String(servers.total)} />
        <StatCard label="Roles" value={String(roles.total)} />
        <StatCard label="Access grants" value={String(access.total)} tone="good" />
      </StatGrid>
      <Card title="Connected servers">
        <DataTable
          rows={servers.data}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No Discord servers connected"
              message="Connect a server so SettleKit can assign roles to paying members."
            />
          }
          columns={[
            { header: "Server", cell: (s) => s.name },
            { header: "Members", cell: (s) => formatNumber(s.memberCount) },
            { header: "Connected", cell: (s) => formatDate(s.connectedAt) },
          ]}
        />
      </Card>
    </>
  );
}
