import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

const DELIVERY_NAV = [
  { label: "Runs", href: "/delivery/runs" },
  { label: "Logs", href: "/delivery/logs" },
];

const LEVEL_TONE: Record<string, string> = {
  info: "neutral",
  warn: "warn",
  error: "bad",
};

export default async function DeliveryLogsPage() {
  const logs = await api.delivery.logs();
  return (
    <>
      <PageHeader
        title="Delivery Logs"
        description="Detailed step-by-step logs for each delivery run, for debugging failures."
      />
      <SubNav items={DELIVERY_NAV} />
      <ErrorBanner error={logs.error} />
      <Card>
        <DataTable
          rows={logs.data}
          getKey={(l) => l.id}
          empty={
            <EmptyState
              title="No logs yet"
              message="Log lines for every delivery attempt appear here as runs execute."
            />
          }
          columns={[
            { header: "Time", cell: (l) => formatDateTime(l.at) },
            { header: "Run", cell: (l) => <span className="mono">{l.runId}</span> },
            {
              header: "Level",
              cell: (l) => (
                <span className={`badge badge-${LEVEL_TONE[l.level] ?? "neutral"}`}>
                  {l.level}
                </span>
              ),
            },
            { header: "Message", cell: (l) => l.message },
          ]}
        />
      </Card>
    </>
  );
}
