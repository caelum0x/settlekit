import Link from "next/link";
import { notFound } from "next/navigation";
import { merchantApi } from "@/lib/merchant-api";
import { formatDateTime, humanize } from "@/lib/format";
import { formatUsd } from "@/lib/merchant-types";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";
import { NetworkChip, SourceTag } from "@/components/NetworkBadge";
import { RefundForm } from "@/components/RefundForm";

export const dynamic = "force-dynamic";

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const result = await merchantApi.payment(params.id);
  if (!result.data && result.error?.includes("404")) notFound();
  const p = result.data;
  if (!p) {
    return (
      <>
        <PageHeader title="Payment" />
        <ErrorBanner error={result.error} />
      </>
    );
  }
  const title = p.products.map((x) => x.name).join(", ") || "Payment";

  return (
    <>
      <div className="breadcrumb">
        <Link href="/payments">Payments</Link> / {p.id}
      </div>
      <PageHeader
        title={`${formatUsd(p.amountUsd)} for ${title}`}
        description={`${p.networkName} · ${p.asset}${p.env === "testnet" ? " · testnet" : ""}`}
        action={
          p.status === "confirmed" ? (
            <RefundForm
              paymentId={p.id}
              amountUsd={p.amountUsd}
              asset={p.asset}
              networkName={p.networkName}
              buyerWallet={p.buyer.wallet}
            />
          ) : (
            <StatusBadge status={p.status} />
          )
        }
      />

      <Card title="Timeline">
        <ol className="timeline">
          {p.timeline.map((step) => (
            <li key={step.key} className={step.done ? "done" : "todo"}>
              <span className="timeline-dot" />
              <div className="timeline-body">
                <div className="timeline-title">{step.label}</div>
                <div className="timeline-meta">
                  {step.at ? formatDateTime(step.at) : step.done ? "" : "Waiting"}
                  {step.detail ? ` · ${step.detail}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Details">
        <dl className="detail-grid">
          <dt>Status</dt>
          <dd>
            <StatusBadge status={p.status === "confirmed" ? "paid" : p.status} />
          </dd>
          <dt>Network</dt>
          <dd>
            <NetworkChip name={p.networkName} asset={p.asset} env={p.env} />
          </dd>
          <dt>Amount</dt>
          <dd>
            {formatUsd(p.amountUsd)}
            {p.settled ? ` (paid ${p.settled.amount} ${p.settled.asset})` : ""}
          </dd>
          <dt>Source</dt>
          <dd>
            <SourceTag source={p.source} />
          </dd>
          <dt>Transaction</dt>
          <dd className="mono">
            {p.txHash ? (
              p.explorerUrl ? (
                <a className="link" href={p.explorerUrl} target="_blank" rel="noreferrer">
                  {p.txHash}
                </a>
              ) : (
                p.txHash
              )
            ) : (
              "Not paid yet"
            )}
          </dd>
          {p.routedFrom ? (
            <>
              <dt>Routed from</dt>
              <dd>
                Paid with <span className="mono">{p.routedFrom.originToken}</span> on chain {p.routedFrom.originChainId} via{" "}
                {p.routedFrom.provider} ({p.routedFrom.state})
                {p.routedFrom.originTxHash ? (
                  <>
                    {" "}
                    · origin tx <span className="mono">{p.routedFrom.originTxHash}</span>
                  </>
                ) : null}
              </dd>
            </>
          ) : null}
          <dt>Buyer</dt>
          <dd>
            {[p.buyer.email, p.buyer.githubUsername ? `GitHub @${p.buyer.githubUsername}` : null, p.buyer.discordUserId ? `Discord ${p.buyer.discordUserId}` : null]
              .filter(Boolean)
              .join(" · ") || "No details collected"}
          </dd>
          <dt>Buyer wallet</dt>
          <dd className="mono">{p.buyer.wallet ?? "—"}</dd>
          <dt>Checkout session</dt>
          <dd className="mono">{p.sessionId ?? "—"}</dd>
        </dl>
      </Card>

      <Card title="Access delivered">
        {p.entitlements.length === 0 ? (
          <p className="muted">No access recorded for this payment yet.</p>
        ) : (
          <ul className="plain-list">
            {p.entitlements.map((e) => (
              <li key={e.id}>
                <StatusBadge status={e.status} /> {humanize(e.entitlementType)} · granted {formatDateTime(e.createdAt)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {p.refunds.length > 0 ? (
        <Card title="Refunds">
          <ul className="plain-list">
            {p.refunds.map((r) => (
              <li key={r.id}>
                <StatusBadge status={r.status} /> {formatUsd(r.amount.amount)} · {humanize(r.reason)} · {formatDateTime(r.createdAt)}
                {r.txHash ? (
                  <>
                    {" "}
                    · <span className="mono">{r.txHash}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
