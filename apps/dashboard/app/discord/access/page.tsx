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
import { DISCORD_NAV } from "../nav";

export const dynamic = "force-dynamic";

async function grantDiscord(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.discord.grant(
    values.customerEmail ?? "",
    values.roleId ?? "",
  );
  return error;
}

export default async function DiscordAccessPage() {
  const access = await api.discord.access();
  return (
    <>
      <PageHeader
        title="Discord Access Grants"
        description="Members who received a paid role, automatically or by manual grant."
      />
      <SubNav items={DISCORD_NAV} />
      <ErrorBanner error={access.error} />
      <Card title="Grants">
        <DataTable
          rows={access.data}
          getKey={(g) => g.id}
          empty={
            <EmptyState
              title="No role grants yet"
              message="Paid members get roles assigned on purchase. You can also assign manually below."
            />
          }
          columns={[
            { header: "Customer", cell: (g) => g.customerEmail },
            { header: "Role", cell: (g) => g.roleName },
            { header: "Server", cell: (g) => g.serverName },
            { header: "Status", cell: (g) => <StatusBadge status={g.status} /> },
            { header: "Granted", cell: (g) => formatDateTime(g.grantedAt) },
          ]}
        />
      </Card>
      <Card title="Assign role manually">
        <SimpleCreateForm
          submitLabel="Assign role"
          successMessage="Role assigned."
          action={grantDiscord}
          fields={[
            { name: "customerEmail", label: "Customer email", type: "email", required: true },
            { name: "roleId", label: "Role ID", required: true, placeholder: "Discord role ID" },
          ]}
        />
      </Card>
    </>
  );
}
