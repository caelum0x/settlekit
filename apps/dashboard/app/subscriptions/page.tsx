import { api } from "@/lib/api";
import { billing, type OnchainSubscription } from "@/lib/billing";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { PageHeader, Card, DataTable, StatusBadge, EmptyState, ErrorBanner, StatCard, StatGrid } from "@/components/ui";
import { CancelSubscription } from "@/components/CancelSubscription";

export const dynamic = "force-dynamic";

const METHOD_LABEL: Record<OnchainSubscription["method"], string> = {
  spend_permission: "Spend permission",
  permit2: "Permit2 allowance",
  spl_delegate: "SPL delegate",
  renewal_invoice: "Renewal invoice",
};

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function ChargeState({ s }: { s: OnchainSubscription }) {
  const last = s.lastCharge;
  if (s.dunning !== "none") {
    return (
      <div>
        <StatusBadge status={s.dunning === "retrying" ? "retrying" : "failed"} />
        <div className="muted small">{s.lastChargeError ?? last?.failureReason ?? "Charge failed"}</div>
      </div>
    );
  }
  if (!last) return <span className="muted">No charges yet</span>;
  return (
    <div>
      <StatusBadge status={last.status} /> ${last.amount}
      {last.explorerUrl ? (
        <div className="small">
          <a className="link mono" href={last.explorerUrl} target="_blank" rel="noreferrer">
            {short(last.txHash ?? "")}
          </a>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Onchain subscriptions (wallet grants and renewal invoices): who is
 * subscribed, on which network, the next charge, dunning state and cancel.
 * Falls back to the core subscription list when onchain billing is off.
 */
export default async function SubscriptionsPage() {
  const onchain = await billing.subscriptions();
  const billingOff = onchain.status === 404;

  if (billingOff) {
    const subs = await api.subscriptions.list();
    return (
      <>
        <PageHeader title="Subscriptions" description="Recurring plans and renewal status." />
        <div className="card callout">
          Onchain subscription billing is not enabled on this deployment (set ONCHAIN_BILLING_OPERATOR_PRIVATE_KEY and
          ONCHAIN_BILLING_CHECKOUT_URL on the API). Buyers can still pay monthly and yearly prices one period at a time.
        </div>
        <ErrorBanner error={subs.error} />
        <Card>
          <DataTable
            rows={subs.data}
            getKey={(s) => s.id}
            empty={<EmptyState title="No subscriptions yet" message="Monthly and yearly plans appear here with their renewal dates." />}
            columns={[
              { header: "Customer", cell: (s) => s.customerEmail },
              { header: "Plan", cell: (s) => s.planName },
              { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
              { header: "Renews", cell: (s) => formatRelative(s.currentPeriodEnd) },
              { header: "Amount", align: "right", cell: (s) => formatMoney(s.amount) },
            ]}
          />
        </Card>
      </>
    );
  }

  const rows = onchain.data ?? [];
  const active = rows.filter((s) => s.status === "active");
  const dunning = rows.filter((s) => s.dunning !== "none");
  const mrr = active.reduce((sum, s) => sum + Number(s.amountPerPeriod) / (s.interval === "yearly" ? 12 : 1), 0);

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Buyers who subscribed at checkout. Charges are pulled on schedule from the buyer's capped wallet grant (or invoiced by email) and paid straight to you."
      />
      <ErrorBanner error={onchain.error} />
      <StatGrid>
        <StatCard label="Active" value={String(active.length)} />
        <StatCard label="Monthly recurring" value={`$${mrr.toFixed(2)}`} />
        <StatCard label="In dunning" value={String(dunning.length)} />
      </StatGrid>
      <Card>
        <DataTable<OnchainSubscription>
          rows={rows}
          getKey={(s) => s.id}
          empty={
            <EmptyState
              title="No subscriptions yet"
              message="Give a product a monthly or yearly price and share its payment link: buyers can subscribe with one wallet approval."
            />
          }
          columns={[
            {
              header: "Customer",
              cell: (s) => (
                <div>
                  <div>{s.customerEmail ?? <span className="mono">{s.customerId}</span>}</div>
                  {s.payer ? <div className="muted small mono">{short(s.payer)}</div> : null}
                </div>
              ),
            },
            {
              header: "Plan",
              cell: (s) => (
                <div>
                  <div>{s.productName}</div>
                  <div className="muted small">
                    ${s.amountPerPeriod} / {s.interval === "yearly" ? "year" : "month"}
                  </div>
                </div>
              ),
            },
            {
              header: "Network",
              cell: (s) => (
                <div>
                  <div>{s.networkName}</div>
                  <div className="muted small">{METHOD_LABEL[s.method]}</div>
                </div>
              ),
            },
            {
              header: "Status",
              cell: (s) => (
                <div>
                  <StatusBadge status={s.status} />
                  {s.cancelAtPeriodEnd && s.status !== "canceled" ? (
                    <div className="muted small">ends {formatDate(s.currentPeriodEnd)}</div>
                  ) : null}
                </div>
              ),
            },
            {
              header: "Next charge",
              cell: (s) => (s.nextChargeAt ? formatDate(s.nextChargeAt) : <span className="muted">None</span>),
            },
            { header: "Last charge", cell: (s) => <ChargeState s={s} /> },
            {
              header: "",
              align: "right",
              cell: (s) =>
                s.status === "canceled" || (s.cancelAtPeriodEnd && s.status === "active") ? null : (
                  <CancelSubscription id={s.id} periodEnd={s.currentPeriodEnd} />
                ),
            },
          ]}
        />
      </Card>
    </>
  );
}
