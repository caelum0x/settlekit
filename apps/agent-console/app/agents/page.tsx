import {
  Card,
  DataTable,
  DemoNotice,
  EmptyState,
  ErrorBanner,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { api } from "@/lib/api";
import type { AgentRecord } from "@/lib/agent-economy-types";
import {
  getAgentConsoleContext,
  getAgentIdentityContext,
  type AgentIdentityRow,
  type AgentStat,
} from "@/lib/data";
import { formatNumber, formatUsdc, shortWallet } from "@/lib/format";

// Reads are never statically cached: router.refresh() after a mutation must
// re-fetch the live list so a newly registered agent appears immediately.
export const dynamic = "force-dynamic";

/**
 * Register an agent identity through the real API (`POST /v1/agents`). The org
 * is implicit from the authenticated key — never send a client-supplied
 * organizationId. Returns an error string, or null on success.
 */
async function registerAgent(values: Record<string, string>): Promise<string | null> {
  "use server";
  const owner = (values.owner ?? "").trim();
  const metadataUri = (values.metadataUri ?? "").trim();
  const displayName = (values.displayName ?? "").trim();
  if (!owner) return "Owner wallet is required.";
  if (!metadataUri) return "Metadata URI is required.";
  const { error } = await api.agents.create({
    owner,
    metadataUri,
    ...(displayName ? { displayName } : {}),
  });
  return error;
}

function reputationLabel(agent: AgentRecord): string {
  if (agent.reputationCount && agent.reputationCount > 0) {
    const score = agent.reputationScore ?? 0;
    return `${score} / 100`;
  }
  return "—";
}

/** Live view: real AgentRecord rows from the API. */
function LiveAgents({ agents }: { agents: AgentRecord[] }) {
  const ownerWallets = new Set(agents.map((a) => a.owner)).size;
  const rated = agents.filter((a) => (a.reputationCount ?? 0) > 0);
  const avgReputation =
    rated.length > 0
      ? Math.round(
          (rated.reduce((acc, a) => acc + (a.reputationScore ?? 0), 0) /
            rated.length) *
            10,
        ) / 10
      : 0;

  return (
    <>
      <StatGrid>
        <StatCard
          label="Agents registered"
          value={formatNumber(agents.length)}
          hint="Live API records"
        />
        <StatCard label="Owner wallets" value={formatNumber(ownerWallets)} />
        <StatCard
          label="With feedback"
          value={`${rated.length} / ${agents.length}`}
        />
        <StatCard
          label="Avg reputation"
          value={`${avgReputation} / 100`}
          hint="Mean feedback score"
        />
      </StatGrid>

      <Card title="Agent identity (ERC-8004)">
        <DataTable<AgentRecord>
          rows={agents}
          getKey={(r) => r.id}
          columns={[
            {
              header: "Agent ID",
              cell: (r) => <span className="mono">{r.id}</span>,
            },
            {
              header: "Owner",
              cell: (r) => (
                <span className="mono" title={r.owner}>
                  {shortWallet(r.owner)}
                </span>
              ),
            },
            {
              header: "Name",
              cell: (r) => (r.displayName ? r.displayName : <span className="muted">—</span>),
            },
            {
              header: "Metadata URI",
              cell: (r) => (
                <span className="mono muted" title={r.metadataUri}>
                  {r.metadataUri}
                </span>
              ),
            },
            {
              header: "Reputation",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {reputationLabel(r)}{" "}
                  <span className="muted">
                    ({formatNumber(r.reputationCount ?? 0)})
                  </span>
                </span>
              ),
            },
          ]}
          empty={
            <EmptyState
              title="No agent identities"
              message="Register an agent below to mint its identity and start recording reputation feedback."
            />
          }
        />
      </Card>
    </>
  );
}

/** Offline fallback: deterministic LocalPort demo identities + x402 spend. */
async function DemoAgents() {
  const { agents } = getAgentConsoleContext();
  const identity = await getAgentIdentityContext();

  return (
    <>
      <StatGrid>
        <StatCard
          label="Agents registered"
          value={formatNumber(identity.totals.agentsRegistered)}
          hint="ERC-8004 identities"
        />
        <StatCard
          label="Owner wallets"
          value={formatNumber(identity.totals.ownerWallets)}
        />
        <StatCard
          label="Validations passed"
          value={`${identity.totals.validationsPassed} / ${identity.totals.validationsTotal}`}
          tone={
            identity.totals.validationsPassed === identity.totals.validationsTotal
              ? "good"
              : "warn"
          }
        />
        <StatCard
          label="Avg reputation"
          value={`${identity.totals.avgReputation} / 100`}
          hint="Mean feedback score"
        />
      </StatGrid>

      <Card title="Agent identity (ERC-8004)">
        <DataTable<AgentIdentityRow>
          rows={identity.agents}
          getKey={(r) => r.agentId}
          columns={[
            {
              header: "Agent ID",
              cell: (r) => <span className="mono">#{r.agentId}</span>,
            },
            {
              header: "Owner",
              cell: (r) => (
                <span className="mono" title={r.owner}>
                  {shortWallet(r.owner)}
                </span>
              ),
            },
            {
              header: "Metadata URI",
              cell: (r) => (
                <span className="mono muted" title={r.metadataUri}>
                  {r.metadataUri}
                </span>
              ),
            },
            {
              header: "Reputation",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {r.avgScore} / 100{" "}
                  <span className="muted">({formatNumber(r.feedbackCount)})</span>
                </span>
              ),
            },
            {
              header: "Validation",
              align: "right",
              cell: (r) => <StatusBadge status={r.validationStatus} />,
            },
          ]}
          empty={
            <EmptyState
              title="No agent identities"
              message="Register an ERC-8004 agent to see its identity, reputation, and validation status here."
            />
          }
        />
      </Card>

      <Card title="Autonomous spend (x402)">
        <DataTable<AgentStat>
          rows={agents}
          getKey={(r) => r.id}
          columns={[
            { header: "Agent", cell: (r) => <span style={{ fontWeight: 600 }}>{r.name}</span> },
            {
              header: "Budget cap",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.budgetUsdc)}</span>,
            },
            { header: "Services", align: "right", cell: (r) => <span className="mono">{formatNumber(r.servicesUsed)}</span> },
            { header: "Requests", align: "right", cell: (r) => <span className="mono">{formatNumber(r.requests)}</span> },
            {
              header: "Spent (x402)",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatUsdc(r.spent.amount)}
                </span>
              ),
            },
            {
              header: "Budget used",
              align: "right",
              cell: (r) => {
                const pct = Math.round(r.budgetUsedPct * 100);
                const tone = pct >= 80 ? "badge-bad" : pct >= 50 ? "badge-warn" : "badge-good";
                return <span className={`badge ${tone}`}>{pct}%</span>;
              },
            },
            {
              header: "Proofs",
              align: "right",
              cell: (r) => <span className="mono">{formatNumber(r.proofsPresented)}</span>,
            },
          ]}
          empty={<EmptyState title="No agents" message="Register an autonomous agent to see its x402 spend and proofs here." />}
        />
      </Card>
    </>
  );
}

export default async function AgentsPage() {
  const result = await api.agents.list();
  // Fall back to the deterministic demo context when the API is unreachable
  // (error) or returns no records, so offline dev still renders.
  const live = !result.error && result.data.length > 0;

  return (
    <>
      <PageHeader
        title="Agents"
        description="Agent identity (ERC-8004) and autonomous spend. Each agent holds an identity with reputation feedback, a budget cap, and pays per call via x402."
      />

      {live ? null : <ErrorBanner error={result.error} />}
      {live ? null : <DemoNotice />}

      {live ? <LiveAgents agents={result.data} /> : <DemoAgents />}

      <Card title="Register an agent">
        <p className="muted">
          Register an agent identity in the SettleKit registry. The organization
          is taken from the server API key — no org field is required.
        </p>
        <SimpleCreateForm
          submitLabel="Register agent"
          successMessage="Agent registered."
          action={registerAgent}
          fields={[
            {
              name: "owner",
              label: "Owner wallet",
              required: true,
              placeholder: "0x…",
              hint: "The wallet that owns this agent identity.",
            },
            {
              name: "metadataUri",
              label: "Metadata URI",
              required: true,
              placeholder: "ipfs://agent/metadata.json",
            },
            {
              name: "displayName",
              label: "Display name (optional)",
              placeholder: "Atlas Researcher",
            },
          ]}
        />
      </Card>
    </>
  );
}
