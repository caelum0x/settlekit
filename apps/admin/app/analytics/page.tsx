import { api } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import {
  bucketByDay,
  countBy,
  sumSettledVolume,
  type BarDatum,
} from "@/lib/analytics";
import { MetricCard } from "../components/ui";
import { BarChart } from "../components/BarChart";

export const dynamic = "force-dynamic";

/**
 * Analytics / reporting console. A server component that fetches the raw lists
 * in parallel and aggregates them in-process (there are no pre-bucketed totals
 * in the API beyond overview()). Everything degrades to a labelled empty state
 * when a list is empty, and money is summed with addMoney/money — never with
 * floating point. Bars are CSS divs (no chart dependency).
 *
 * The feature brief mentions "agents" and "jobs" totals; those entities do not
 * exist in this admin's domain model, so they are surfaced as explicit "n/a"
 * cards rather than invented endpoints.
 */

const DECISION_TONES = ["ok", "warn", "danger"] as const;

export default async function AnalyticsPage() {
  let overview;
  let settlements;
  let webhooks;
  let risk;
  try {
    [overview, settlements, webhooks, risk] = await Promise.all([
      api.overview(),
      api.settlements(),
      api.webhookEvents(),
      api.riskProfiles(),
    ]);
  } catch (e) {
    return (
      <>
        <h1>Analytics</h1>
        <div className="error">
          Failed to load analytics: {e instanceof Error ? e.message : "unknown"}
        </div>
      </>
    );
  }

  const settledVolume = sumSettledVolume(settlements);

  // Settlements created per day (last 14 days, zero-filled).
  const settlementSeries: BarDatum[] = bucketByDay(
    settlements,
    (s) => s.createdAt,
  ).map((b) => ({ label: b.date.slice(5), value: b.count }));

  // Webhook events created per day.
  const webhookSeries: BarDatum[] = bucketByDay(
    webhooks,
    (w) => w.createdAt,
  ).map((b) => ({ label: b.date.slice(5), value: b.count }));

  // Risk decision distribution (allow / review / block).
  const decisionCounts = countBy(risk, (r) => r.decision);
  const decisionSeries: BarDatum[] = [
    { label: "allow", value: decisionCounts.get("allow") ?? 0 },
    { label: "review", value: decisionCounts.get("review") ?? 0 },
    { label: "block", value: decisionCounts.get("block") ?? 0 },
  ];

  const deliveredCount = webhooks.filter((w) => w.delivered).length;
  const pendingCount = webhooks.length - deliveredCount;
  const deliverySeries: BarDatum[] = [
    { label: "delivered", value: deliveredCount },
    { label: "pending", value: pendingCount },
  ];

  return (
    <>
      <h1>Analytics</h1>
      <p className="subtitle">
        Aggregated reporting across settlements, payments, webhooks, and risk.
        Settlements and webhook activity are bucketed by day; risk reflects the
        admin-owned review store.
      </p>

      <div className="cards">
        <MetricCard
          label="Settled volume"
          value={formatMoney(settledVolume)}
        />
        <MetricCard label="GMV (confirmed)" value={formatMoney(overview.gmv)} />
        <MetricCard label="Settlements" value={settlements.length} />
        <MetricCard
          label="Confirmed payments"
          value={overview.confirmedPaymentCount}
        />
        <MetricCard label="Webhook events" value={webhooks.length} />
        <MetricCard label="Risk review queue" value={overview.riskReviewQueue} />
        <MetricCard
          label="Undelivered webhooks"
          value={overview.undeliveredWebhooks}
        />
        <MetricCard label="Agents" value="n/a" />
        <MetricCard label="Jobs" value="n/a" />
      </div>

      <div className="analytics-actions">
        <a className="btn" href="/api/export/settlements" download>
          Export settlements CSV
        </a>
      </div>

      <h2>Settlements per day</h2>
      <div className="panel chart-panel">
        <BarChart
          data={settlementSeries}
          tone="accent"
          emptyText="No settlements in the last 14 days."
        />
      </div>

      <h2>Webhook events per day</h2>
      <div className="panel chart-panel">
        <BarChart
          data={webhookSeries}
          tone="muted"
          emptyText="No webhook events in the last 14 days."
        />
      </div>

      <h2>Risk decision distribution</h2>
      <div className="panel chart-panel">
        {risk.length === 0 ? (
          <div className="empty">No risk profiles.</div>
        ) : (
          <BarChart data={decisionSeries} tones={DECISION_TONES} />
        )}
      </div>

      <h2>Webhook delivery status</h2>
      <div className="panel chart-panel">
        {webhooks.length === 0 ? (
          <div className="empty">No webhook events.</div>
        ) : (
          <BarChart
            data={deliverySeries}
            tones={["ok", "warn"]}
          />
        )}
      </div>
    </>
  );
}
