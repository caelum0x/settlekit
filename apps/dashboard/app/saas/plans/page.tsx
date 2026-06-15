import { api } from "@/lib/api";
import { formatMoney, humanize } from "@/lib/format";
import {
  PageHeader,
  SubNav,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";
import { SAAS_NAV } from "../nav";

export const dynamic = "force-dynamic";

async function createPlan(values: Record<string, string>): Promise<string | null> {
  "use server";
  const interval = values.interval === "yearly" ? "yearly" : "monthly";
  const amount = Math.round((parseFloat(values.amount || "0") || 0) * 1_000_000);
  const { error } = await api.saas.createPlan(values.name ?? "", amount, interval);
  return error;
}

export default async function SaasPlansPage() {
  const plans = await api.saas.plans();
  return (
    <>
      <PageHeader
        title="SaaS Plans"
        description="Subscription tiers that grant entitlements and seats to your product."
      />
      <SubNav items={SAAS_NAV} />
      <ErrorBanner error={plans.error} />
      <Card title="Plans">
        <DataTable
          rows={plans.data}
          getKey={(p) => p.id}
          empty={
            <EmptyState
              title="No SaaS plans yet"
              message="Create a plan below — buyers who subscribe get entitlements granted automatically."
            />
          }
          columns={[
            { header: "Plan", cell: (p) => p.name },
            { header: "Interval", cell: (p) => humanize(p.interval) },
            {
              header: "Features",
              cell: (p) => (
                <div className="tag-list">
                  {p.features.length === 0 ? (
                    <span className="dim">—</span>
                  ) : (
                    p.features.map((f) => (
                      <span className="tag" key={f}>
                        {f}
                      </span>
                    ))
                  )}
                </div>
              ),
            },
            { header: "Seats", cell: (p) => (p.seats == null ? "Unlimited" : String(p.seats)) },
            { header: "Price", align: "right", cell: (p) => formatMoney(p.price) },
          ]}
        />
      </Card>
      <Card title="Create plan">
        <SimpleCreateForm
          submitLabel="Create plan"
          successMessage="Plan created."
          action={createPlan}
          fields={[
            { name: "name", label: "Plan name", required: true, placeholder: "Pro" },
            { name: "amount", label: "Price (USDC)", type: "number", required: true, placeholder: "29.00" },
            {
              name: "interval",
              label: "Billing interval",
              required: true,
              options: [
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ],
            },
          ]}
        />
      </Card>
    </>
  );
}
