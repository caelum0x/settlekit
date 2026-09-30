import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader, Card, DataTable, EmptyState, ErrorBanner } from "@/components/ui";
import { CreatePlatformKey } from "@/components/CreatePlatformKey";

export const dynamic = "force-dynamic";

/** Scopes offered in the dashboard (write includes read). */
const SCOPES = [
  "payments:read",
  "payments:write",
  "checkout:write",
  "products:read",
  "products:write",
  "customers:read",
  "customers:write",
  "access:read",
  "invoices:write",
  "webhooks:write",
  "reports:read",
  "api_keys:write",
] as const;

async function createKey(label: string, scopes: string[]): Promise<{ plaintext?: string; error?: string }> {
  "use server";
  const { data, error } = await api.apiKeys.createPlatform(label, scopes);
  return data ? { plaintext: data.plaintext } : { error: error ?? "Could not create the key." };
}

async function revokeKey(id: string): Promise<void> {
  "use server";
  await api.apiKeys.revoke(id);
  revalidatePath("/api-keys");
}

export default async function ApiKeysPage() {
  const keys = await api.apiKeys.list();
  const platform = keys.data.filter((k) => k.kind === "platform");
  const buyer = keys.data.filter((k) => k.kind === "customer");
  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys for your backend. Give each integration only the scopes it needs; access keys delivered to buyers can never call this API."
      />
      <ErrorBanner error={keys.error} />
      <Card title="Your API keys">
        <DataTable
          rows={platform}
          getKey={(k) => k.id}
          empty={<EmptyState title="No API keys yet" message="Create a key below for server-to-server requests." />}
          columns={[
            { header: "For", cell: (k) => k.name },
            { header: "Prefix", cell: (k) => <span className="mono">{k.prefix}...</span> },
            {
              header: "Scopes",
              cell: (k) => (
                <div className="tag-list">
                  {k.scopes.map((s) => (
                    <span className="tag" key={s}>
                      {s === "platform:admin" || s === "*" ? "full access" : s}
                    </span>
                  ))}
                </div>
              ),
            },
            { header: "Last used", cell: (k) => (k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "Never") },
            { header: "Created", cell: (k) => formatDate(k.createdAt) },
            {
              header: "",
              cell: (k) =>
                k.status === "active" ? (
                  <form action={revokeKey.bind(null, k.id)}>
                    <button type="submit" className="btn btn-small">
                      Revoke
                    </button>
                  </form>
                ) : (
                  <span className="dim">revoked</span>
                ),
            },
          ]}
        />
      </Card>
      <Card title="Create API key">
        <CreatePlatformKey action={createKey} scopes={SCOPES} />
      </Card>
      {buyer.length > 0 ? (
        <Card title="Access keys delivered to buyers">
          <DataTable
            rows={buyer}
            getKey={(k) => k.id}
            empty={null}
            columns={[
              { header: "Buyer", cell: (k) => k.name },
              { header: "Prefix", cell: (k) => <span className="mono">{k.prefix}...</span> },
              { header: "Scopes", cell: (k) => k.scopes.join(", ") },
              { header: "Status", cell: (k) => k.status },
              { header: "Created", cell: (k) => formatDate(k.createdAt) },
            ]}
          />
        </Card>
      ) : null}
    </>
  );
}
