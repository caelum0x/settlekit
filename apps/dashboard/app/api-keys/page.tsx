import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

async function createApiKey(values: Record<string, string>): Promise<string | null> {
  "use server";
  const scopes = (values.scopes ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { error } = await api.apiKeys.create(values.name ?? "", scopes);
  return error;
}

export default async function ApiKeysPage() {
  const keys = await api.apiKeys.list();
  return (
    <>
      <PageHeader
        title="API Keys"
        description="Programmatic access to the SettleKit API for your backend and integrations."
      />
      <ErrorBanner error={keys.error} />
      <Card title="Your API keys">
        <DataTable
          rows={keys.data}
          getKey={(k) => k.id}
          empty={
            <EmptyState
              title="No API keys yet"
              message="Create a key below to authenticate server-to-server requests."
            />
          }
          columns={[
            { header: "Name", cell: (k) => k.name },
            { header: "Prefix", cell: (k) => <span className="mono">{k.prefix}…</span> },
            {
              header: "Scopes",
              cell: (k) => (
                <div className="tag-list">
                  {k.scopes.map((s) => (
                    <span className="tag" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              ),
            },
            {
              header: "Last used",
              cell: (k) => (k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never"),
            },
            { header: "Created", cell: (k) => formatDate(k.createdAt) },
          ]}
        />
      </Card>
      <Card title="Create API key">
        <SimpleCreateForm
          submitLabel="Create key"
          successMessage="API key created."
          action={createApiKey}
          fields={[
            { name: "name", label: "Key name", required: true, placeholder: "Production backend" },
            {
              name: "scopes",
              label: "Scopes",
              placeholder: "products:read, payments:read",
              hint: "Comma-separated list of scopes.",
            },
          ]}
        />
      </Card>
    </>
  );
}
