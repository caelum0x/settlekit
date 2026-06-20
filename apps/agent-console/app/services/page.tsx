import { Card, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { getAgentConsoleContext, type ServiceListing } from "@/lib/data";
import { formatNumber, formatUsdc } from "@/lib/format";

/** Render a 0..5 average as filled/empty stars plus the numeric mean. */
function Stars({ average, count }: { average: number; count: number }) {
  const rounded = Math.round(average);
  const filled = "★".repeat(rounded);
  const empty = "☆".repeat(Math.max(0, 5 - rounded));
  return (
    <span className="mono" title={`${average.toFixed(2)} from ${count} ratings`}>
      <span style={{ color: "var(--good)" }}>{filled}</span>
      {empty} {average.toFixed(1)}
    </span>
  );
}

export default function ServicesPage() {
  const { services } = getAgentConsoleContext();

  return (
    <>
      <PageHeader
        title="Services"
        description="Agent-services published to the marketplace. Each advertises a machine-readable §11 metadata document so an agent knows how to call and pay for it via x402."
      />

      <Card title="Discovered agent-services">
        <DataTable<ServiceListing>
          rows={services}
          getKey={(r) => r.id}
          columns={[
            {
              header: "Service",
              cell: (r) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{r.description}</div>
                </div>
              ),
            },
            {
              header: "Protocol",
              cell: (r) => (
                <span className="badge badge-good" title="Payment protocol">
                  {r.paymentProtocol}
                </span>
              ),
            },
            {
              header: "Network",
              cell: (r) => <span className="badge badge-neutral">{r.network}</span>,
            },
            {
              header: "Price / call",
              align: "right",
              cell: (r) => <span className="mono">{formatUsdc(r.priceUsdc)}</span>,
            },
            {
              header: "Reputation",
              cell: (r) => <Stars average={r.ratingAverage} count={r.ratingCount} />,
            },
            { header: "Requests", align: "right", cell: (r) => <span className="mono">{formatNumber(r.requests)}</span> },
            {
              header: "Revenue (x402)",
              align: "right",
              cell: (r) => (
                <span className="mono" style={{ fontWeight: 600 }}>
                  {formatUsdc(r.revenue.amount)}
                </span>
              ),
            },
            {
              header: "Endpoint",
              cell: (r) => (
                <code className="mono" style={{ fontSize: 12 }}>
                  {shortenEndpoint(r.endpoint)}
                </code>
              ),
            },
          ]}
          empty={
            <EmptyState
              title="No services discovered"
              message="Publish an agent-service to surface it in the discovery feed."
            />
          }
        />
      </Card>
    </>
  );
}

/** Drop the scheme and trim a long path so the endpoint fits a table cell. */
function shortenEndpoint(endpoint: string): string {
  const noScheme = endpoint.replace(/^https?:\/\//, "");
  return noScheme.length <= 40 ? noScheme : `${noScheme.slice(0, 37)}…`;
}
