import Link from "next/link";
import { api } from "@/lib/api";
import {
  countActive,
  entitlementsOfType,
  loadCustomerScope,
  paymentIdsFrom,
} from "@/lib/load";
import type { Payment } from "@/lib/types";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable, type Column } from "@/components/DataTable";
import { ErrorNote } from "@/components/PageHeader";
import { formatDate, formatMoney, humanize } from "@/lib/format";

export default async function OverviewPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const scope = await loadCustomerScope(customerId);
  const { entitlements, customer, error, productNames } = scope;

  const subs = entitlementsOfType(entitlements, ["saas_feature"]);
  const licenses = entitlementsOfType(entitlements, ["license_key"]);
  const apiAccess = entitlementsOfType(entitlements, ["api_access", "api_credits"]);

  // Fetch up to the 5 most recent granting payments.
  const paymentIds = paymentIdsFrom(entitlements).slice(0, 5);
  const paymentResults = await Promise.all(paymentIds.map((id) => api.payments.get(id)));
  const payments = paymentResults
    .map((r) => r.data)
    .filter((p): p is Payment => p !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const columns: Column<Payment>[] = [
    {
      key: "amount",
      header: "Amount",
      render: (p) => <strong>{formatMoney(p.amount)}</strong>,
    },
    { key: "date", header: "Date", render: (p) => formatDate(p.createdAt) },
    { key: "network", header: "Network", render: (p) => humanize(p.network) },
    {
      key: "status",
      header: "Status",
      align: "right",
      render: (p) => <StatusBadge status={p.status} />,
    },
  ];

  return (
    <div>
      {error ? <ErrorNote message={error} /> : null}

      {!customer && !error ? (
        <div className="notice">
          No customer found for id <span className="mono">{customerId}</span>.
          Check the id from your receipt, or open the portal again.
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard
          label="Active access"
          value={countActive(entitlements)}
          hint={`${entitlements.length} total entitlements`}
        />
        <StatCard
          label="Subscriptions"
          value={subs.length}
          href={`/c/${encodeURIComponent(customerId)}/subscriptions`}
        />
        <StatCard
          label="License keys"
          value={licenses.length}
          href={`/c/${encodeURIComponent(customerId)}/license-keys`}
        />
        <StatCard
          label="API access"
          value={apiAccess.length}
          href={`/c/${encodeURIComponent(customerId)}/api-keys`}
        />
        <StatCard
          label="Payments"
          value={paymentIdsFrom(entitlements).length}
          href={`/c/${encodeURIComponent(customerId)}/purchases`}
        />
      </div>

      <section className="section">
        <h2 className="section-title">Recent payments</h2>
        <DataTable
          columns={columns}
          rows={payments}
          rowKey={(p) => p.id}
          emptyTitle="No payments yet"
          emptyBody="Confirmed USDC payments will appear here with their on-chain receipt."
        />
        {payments.length > 0 ? (
          <p style={{ marginTop: 10 }}>
            <Link href={`/c/${encodeURIComponent(customerId)}/purchases`}>
              View all purchases →
            </Link>
          </p>
        ) : null}
      </section>

      <section className="section">
        <h2 className="section-title">Your entitlements</h2>
        <DataTable
          columns={[
            {
              key: "type",
              header: "Access",
              render: (e) => humanize(e.entitlementType),
            },
            {
              key: "product",
              header: "Product",
              render: (e) => productNames.get(e.productId) ?? e.productId,
            },
            {
              key: "granted",
              header: "Granted",
              render: (e) => formatDate(e.createdAt),
            },
            {
              key: "status",
              header: "Status",
              align: "right",
              render: (e) => <StatusBadge status={e.status} />,
            },
          ]}
          rows={entitlements}
          rowKey={(e) => e.id}
          emptyTitle="No access yet"
          emptyBody="When you buy something, the access it unlocks shows up here."
        />
      </section>
    </div>
  );
}
