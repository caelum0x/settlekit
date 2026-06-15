import Link from "next/link";
import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { MetricCard } from "./components/ui";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  let overview;
  try {
    overview = await api.overview();
  } catch (e) {
    return (
      <>
        <h1>Platform overview</h1>
        <div className="error">
          Failed to load overview: {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  return (
    <>
      <h1>Platform overview</h1>
      <p className="subtitle">
        Live operating metrics across every tenant on the SettleKit Commerce OS.
      </p>

      <div className="cards">
        <MetricCard
          label="Organizations"
          value={`${overview.activeOrganizations}/${overview.organizationCount}`}
        />
        <MetricCard label="GMV (confirmed)" value={formatMoney(overview.gmv)} />
        <MetricCard
          label="Confirmed payments"
          value={overview.confirmedPaymentCount}
        />
        <MetricCard
          label="Active entitlements"
          value={overview.activeEntitlements}
        />
        <MetricCard
          label="Failed deliveries"
          value={overview.failedDeliveries}
        />
        <MetricCard
          label="Undelivered webhooks"
          value={overview.undeliveredWebhooks}
        />
        <MetricCard label="Risk review queue" value={overview.riskReviewQueue} />
      </div>

      <h2>Where to act</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Queue</th>
              <th>Open items</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Risk review</td>
              <td>{overview.riskReviewQueue}</td>
              <td className="actions">
                <Link href="/risk">Open queue →</Link>
              </td>
            </tr>
            <tr>
              <td>Failed delivery runs</td>
              <td>{overview.failedDeliveries}</td>
              <td className="actions">
                <Link href="/deliveries">View &amp; retry →</Link>
              </td>
            </tr>
            <tr>
              <td>Undelivered webhooks</td>
              <td>{overview.undeliveredWebhooks}</td>
              <td className="actions">
                <Link href="/webhooks">View &amp; replay →</Link>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
