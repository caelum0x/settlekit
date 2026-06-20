import {
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
} from "@/components/ui";
import {
  getAgentConsoleContext,
  getAgentIdentityContext,
  type AgentIdentityRow,
  type AgentStat,
} from "@/lib/data";
import { formatNumber, formatUsdc, shortWallet } from "@/lib/format";

export default async function AgentsPage() {
  const { agents } = getAgentConsoleContext();
  const identity = await getAgentIdentityContext();

  return (
    <>
      <PageHeader
        title="Agents"
        description="Agent identity (ERC-8004) and autonomous spend. Each agent holds an on-chain identity with reputation feedback and validator attestations, a budget cap, and pays per call via x402."
      />

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
