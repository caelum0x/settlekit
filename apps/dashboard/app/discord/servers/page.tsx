import { api, API_URL } from "@/lib/api";
import { formatDate, formatNumber } from "@/lib/format";
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

export default async function DiscordServersPage() {
  const servers = await api.discord.servers();
  return (
    <>
      <PageHeader
        title="Discord Servers"
        description="Guilds connected to SettleKit for paid role assignment."
        action={
          <a className="btn btn-primary" href={`${API_URL}/v1/integrations/discord/connect`}>
            Connect server
          </a>
        }
      />
      <SubNav items={DISCORD_NAV} />
      <ErrorBanner error={servers.error} />
      <Card>
        <DataTable
          rows={servers.data}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No servers connected"
              message="Authorize the SettleKit bot on your Discord server to begin."
            />
          }
          columns={[
            { header: "Server", cell: (s) => s.name },
            { header: "Server ID", cell: (s) => <span className="mono">{s.id}</span> },
            { header: "Members", cell: (s) => formatNumber(s.memberCount) },
            { header: "Connected", cell: (s) => formatDate(s.connectedAt) },
          ]}
        />
      </Card>
    </>
  );
}
