import { Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { getAgentConsoleContext, type AgentStat } from "@/lib/data";
import { formatNumber, formatUsdc } from "@/lib/format";

export default function AgentsPage() {
  const { agents } = getAgentConsoleContext();

  return (
    <>
      <PageHeader
        title="Agents"
        description="Autonomous agents doing commerce: each holds a budget cap, pays per call via x402, and presents proofs-of-citation for the sources it cites."
      />

      <Card title="Autonomous agents">
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
