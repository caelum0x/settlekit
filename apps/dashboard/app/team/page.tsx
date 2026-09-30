import { revalidatePath } from "next/cache";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PageHeader, Card, DataTable, EmptyState, ErrorBanner } from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

const ROLE_HELP: Record<string, string> = {
  owner: "Everything, including billing and the team",
  admin: "Everything except granting owner",
  developer: "Products, checkout, webhooks, API keys; reads the rest",
  support: "Customers and payments (refunds); reads the rest",
  viewer: "Read only",
};

const ROLE_OPTIONS = Object.keys(ROLE_HELP).map((r) => ({ value: r, label: `${r}: ${ROLE_HELP[r]}` }));

async function inviteMember(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.team.invite((values.email ?? "").trim(), values.role || "viewer");
  return error;
}

async function changeRole(accountId: string, role: string): Promise<void> {
  "use server";
  await api.team.setRole(accountId, role);
  revalidatePath("/team");
}

async function removeMember(accountId: string): Promise<void> {
  "use server";
  await api.team.remove(accountId);
  revalidatePath("/team");
}

async function revokeInvite(id: string): Promise<void> {
  "use server";
  await api.team.revokeInvitation(id);
  revalidatePath("/team");
}

export default async function TeamPage() {
  const team = await api.team.get();
  const members = team.data?.members ?? [];
  const invitations = team.data?.invitations ?? [];
  return (
    <>
      <PageHeader title="Team" description="Invite teammates by email and give each one only the access they need." />
      <ErrorBanner error={team.error} />
      <Card title="Members">
        <DataTable
          rows={members}
          getKey={(m) => m.accountId}
          empty={<EmptyState title="Just you" message="Invite a teammate below." />}
          columns={[
            { header: "Email", cell: (m) => m.email },
            { header: "Role", cell: (m) => m.role },
            { header: "Joined", cell: (m) => formatDate(m.joinedAt) },
            {
              header: "",
              cell: (m) => (
                <div style={{ display: "flex", gap: 6 }}>
                  {["admin", "developer", "support", "viewer"]
                    .filter((r) => r !== m.role)
                    .map((r) => (
                      <form key={r} action={changeRole.bind(null, m.accountId, r)}>
                        <button type="submit" className="btn btn-small">
                          Make {r}
                        </button>
                      </form>
                    ))}
                  <form action={removeMember.bind(null, m.accountId)}>
                    <button type="submit" className="btn btn-small">
                      Remove
                    </button>
                  </form>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {invitations.length > 0 ? (
        <Card title="Invitations">
          <DataTable
            rows={invitations}
            getKey={(i) => i.id}
            empty={null}
            columns={[
              { header: "Email", cell: (i) => i.email },
              { header: "Role", cell: (i) => i.role },
              { header: "Status", cell: (i) => i.status },
              { header: "Expires", cell: (i) => formatDate(i.expiresAt) },
              {
                header: "",
                cell: (i) =>
                  i.status === "pending" ? (
                    <form action={revokeInvite.bind(null, i.id)}>
                      <button type="submit" className="btn btn-small">
                        Revoke
                      </button>
                    </form>
                  ) : null,
              },
            ]}
          />
        </Card>
      ) : null}
      <Card title="Invite a teammate">
        <SimpleCreateForm
          submitLabel="Send invitation"
          successMessage="Invitation sent. The link is valid for 7 days."
          action={inviteMember}
          fields={[
            { name: "email", label: "Email", type: "email", required: true, placeholder: "dev@yourcompany.com" },
            { name: "role", label: "Role", options: ROLE_OPTIONS },
          ]}
        />
      </Card>
    </>
  );
}
