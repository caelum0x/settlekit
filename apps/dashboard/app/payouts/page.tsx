import { api } from "@/lib/api";
import { formatMoneyDecimal, formatDate, humanize } from "@/lib/format";
import {
  PageHeader,
  Card,
  StatGrid,
  StatCard,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import type { Payout } from "@/lib/types";

/** Render a take-rate like "2.5% + 0.30" from a basis-points + fixed schedule. */
function formatRate(bps: number, fixed: string): string {
  return `${(bps / 100).toString()}% + ${fixed}`;
}

export const dynamic = "force-dynamic";

type PayoutNetwork = "arc" | "base" | "ethereum";

const NETWORKS: PayoutNetwork[] = ["arc", "base", "ethereum"];

function isNetwork(value: string): value is PayoutNetwork {
  return (NETWORKS as string[]).includes(value);
}

async function createPayout(values: Record<string, string>): Promise<string | null> {
  "use server";
  const networkRaw = (values.network ?? "arc").trim();
  const network: PayoutNetwork = isNetwork(networkRaw) ? networkRaw : "arc";
  const { error } = await api.payouts.create({
    organizationId: (values.organizationId ?? "").trim(),
    walletAddress: (values.walletAddress ?? "").trim(),
    amount: (values.amount ?? "").trim(),
    network,
  });
  return error;
}

export default async function PayoutsPage() {
  const [payouts, balance] = await Promise.all([
    api.payouts.list(),
    api.payouts.balance(),
  ]);
  return (
    <>
      <PageHeader
        title="Payouts"
        description="On-chain settlements to your wallet. Your available balance is your gross USDC volume minus the platform fee and prior payouts."
      />
      <ErrorBanner error={payouts.error} />

      {balance ? (
        <StatGrid>
          <StatCard
            label="Available to withdraw"
            value={formatMoneyDecimal(balance.available)}
            hint="Net of platform fee + prior payouts"
            tone="good"
          />
          <StatCard
            label="Gross volume"
            value={formatMoneyDecimal(balance.grossVolume)}
            hint="Lifetime confirmed payments"
          />
          <StatCard
            label="Platform fee"
            value={formatMoneyDecimal(balance.platformFees)}
            hint={`Take-rate ${formatRate(balance.feeSchedule.bps, balance.feeSchedule.fixed)}`}
            tone="warn"
          />
          <StatCard
            label="Net earnings"
            value={formatMoneyDecimal(balance.netToMerchant)}
            hint="Gross minus platform fee"
          />
        </StatGrid>
      ) : null}
      <Card title="Payouts">
        <DataTable<Payout>
          rows={payouts.data}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No payouts yet"
              message="Create a pending payout below, then mark it paid once the on-chain transfer confirms."
            />
          }
          columns={[
            { header: "ID", cell: (p) => <span className="mono">{p.id}</span> },
            { header: "Organization", cell: (p) => <span className="mono">{p.organizationId}</span> },
            { header: "Wallet", cell: (p) => <span className="mono">{p.walletAddress}</span> },
            { header: "Network", cell: (p) => humanize(p.network) },
            { header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { header: "Created", cell: (p) => formatDate(p.createdAt) },
            { header: "Amount", align: "right", cell: (p) => formatMoneyDecimal(p.amount) },
          ]}
        />
      </Card>
      <Card title="Create payout">
        <SimpleCreateForm
          submitLabel="Create payout"
          successMessage="Payout created."
          action={createPayout}
          fields={[
            { name: "organizationId", label: "Organization ID", required: true, placeholder: "org_…" },
            {
              name: "walletAddress",
              label: "Wallet address",
              required: true,
              placeholder: "0x…",
            },
            {
              name: "amount",
              label: "Amount (USDC)",
              required: true,
              placeholder: "100.00",
              hint: "Decimal USDC. Must not exceed available balance.",
            },
            {
              name: "network",
              label: "Network",
              required: true,
              options: [
                { value: "arc", label: "Arc" },
                { value: "base", label: "Base" },
                { value: "ethereum", label: "Ethereum" },
              ],
            },
          ]}
        />
      </Card>
    </>
  );
}
