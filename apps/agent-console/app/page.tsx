import { Card, DataTable, EmptyState, PageHeader, StatCard, StatGrid } from "@/components/ui";
import { getAgentConsoleContext, type ActivityRow } from "@/lib/data";
import { formatNumber, formatUsdc, formatDateTime } from "@/lib/format";

export default function ConsolePage() {
  const ctx = getAgentConsoleContext();
  const { totals, activity } = ctx;

  return (
    <>
      <PageHeader
        title="Console"
        description="Autonomous agents discovering agent-services, paying per call via x402, and citing the sources they were grounded in — settled in USDC."
      />

      <StatGrid>
        <StatCard label="Agents active" value={formatNumber(totals.agentsActive)} tone="good" hint="Autonomous buyers" />
        <StatCard label="Services discovered" value={formatNumber(totals.servicesDiscovered)} hint="Published to marketplace" />
        <StatCard label="x402 spend" value={formatUsdc(totals.totalSpend.amount)} tone="good" hint="Across all agents" />
        <StatCard label="Citations made" value={formatNumber(totals.citationsMade)} hint="Sources grounded in" />
        <StatCard label="Proofs issued" value={formatNumber(totals.proofsIssued)} hint="Signed proofs-of-citation" />
      </StatGrid>

      <Card title="Recent agent activity">
        <DataTable<ActivityRow>
          rows={activity}
          getKey={(r) => r.id}
          columns={[
            { header: "Time", cell: (r) => <span className="mono">{formatDateTime(r.createdAt)}</span> },
            { header: "Agent", cell: (r) => r.agentName },
            { header: "Service", cell: (r) => r.serviceName },
            {
              header: "Network",
              cell: (r) => <span className="badge badge-neutral">{r.network}</span>,
            },
            { header: "Requests", align: "right", cell: (r) => <span className="mono">{formatNumber(r.units)}</span> },
            {
              header: "Paid (x402)",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatUsdc(r.amount.amount)}
                </span>
              ),
            },
          ]}
          empty={<EmptyState title="No agent activity" message="When agents invoke a service over x402, their calls will print here." />}
        />
      </Card>
    </>
  );
}
