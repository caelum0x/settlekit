import { api } from "@/lib/api";
import { loadCustomerScope, paymentIdsFrom } from "@/lib/load";
import type { Payment } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  explorerTxUrl,
  formatDateTime,
  formatMoney,
  humanize,
  shortHash,
} from "@/lib/format";

export default async function PurchasesPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, error } = await loadCustomerScope(customerId);

  const ids = paymentIdsFrom(entitlements);
  const results = await Promise.all(ids.map((id) => api.payments.get(id)));
  const payments = results
    .map((r) => r.data)
    .filter((p): p is Payment => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<Payment>[] = [
    {
      key: "amount",
      header: "Amount",
      render: (p) => <strong>{formatMoney(p.amount)}</strong>,
    },
    { key: "date", header: "Date", render: (p) => formatDateTime(p.createdAt) },
    { key: "network", header: "Network", render: (p) => humanize(p.network) },
    {
      key: "tx",
      header: "Transaction",
      render: (p) => {
        if (!p.txHash) return <span className="muted">—</span>;
        const url = explorerTxUrl(p.network, p.txHash);
        return url ? (
          <a className="mono" href={url} target="_blank" rel="noopener noreferrer">
            {shortHash(p.txHash)}
          </a>
        ) : (
          <span className="mono">{shortHash(p.txHash)}</span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (p) => <StatusBadge status={p.status} />,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Purchases & receipts"
        description="Every payment you made, settled in USDC, with its on-chain receipt."
      />
      {error ? <ErrorNote message={error} /> : null}
      <DataTable
        columns={columns}
        rows={payments}
        rowKey={(p) => p.id}
        emptyTitle="No purchases yet"
        emptyBody="When a payment is confirmed, its receipt and transaction hash appear here."
      />
    </div>
  );
}
