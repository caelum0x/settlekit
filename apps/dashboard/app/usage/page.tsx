import { api } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

/** Record N units of a metric for a customer+product (usage-based billing). */
async function recordUsage(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.usage.record({
    organizationId: values.organizationId ?? "",
    customerId: values.customerId ?? "",
    productId: values.productId ?? "",
    metric: values.metric ?? "",
    quantity: Number(values.quantity ?? "1"),
  });
  return error;
}

/** Grant prepaid credits to a customer for a product (credit-pack purchase). */
async function grantCredits(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.usage.grantCredits({
    organizationId: values.organizationId ?? "",
    customerId: values.customerId ?? "",
    productId: values.productId ?? "",
    credits: Number(values.credits ?? "0"),
  });
  return error;
}

/** Consume prepaid credits (meter a paid API call / agent invocation). */
async function consumeCredits(values: Record<string, string>): Promise<string | null> {
  "use server";
  const { error } = await api.usage.consumeCredits({
    organizationId: values.organizationId ?? "",
    customerId: values.customerId ?? "",
    productId: values.productId ?? "",
    credits: Number(values.credits ?? "1"),
  });
  return error;
}

const REF_FIELDS = [
  { name: "organizationId", label: "Organization ID", required: true, placeholder: "org_…" },
  { name: "customerId", label: "Customer ID", required: true, placeholder: "cus_…" },
  { name: "productId", label: "Product ID", required: true, placeholder: "prod_…" },
] as const;

export default function UsagePage() {
  return (
    <>
      <PageHeader
        title="Usage & Credits"
        description="Meter usage for paid APIs and AI agent calls, and manage prepaid credit balances. Powers usage-based billing and x402 pay-per-call."
      />

      <Card title="Record usage">
        <p className="muted">
          Increment a metric (e.g. <code>api_calls</code>, <code>tokens</code>) for a customer&apos;s
          product. Meters are created on first use and aggregate within the billing period.
        </p>
        <SimpleCreateForm
          submitLabel="Record usage"
          successMessage="Usage recorded."
          action={recordUsage}
          fields={[
            ...REF_FIELDS,
            { name: "metric", label: "Metric", required: true, placeholder: "api_calls" },
            { name: "quantity", label: "Quantity", type: "number", placeholder: "1", required: true },
          ]}
        />
      </Card>

      <Card title="Grant prepaid credits">
        <p className="muted">
          Add credits to a customer&apos;s balance — e.g. after they buy a <code>20 USDC = 20,000
          credits</code> pack. Credits are consumed per paid call.
        </p>
        <SimpleCreateForm
          submitLabel="Grant credits"
          successMessage="Credits granted."
          action={grantCredits}
          fields={[
            ...REF_FIELDS,
            { name: "credits", label: "Credits", type: "number", placeholder: "20000", required: true },
          ]}
        />
      </Card>

      <Card title="Consume credits">
        <p className="muted">
          Deduct credits for a metered call. Fails when the balance cannot cover the request — the
          same check your paid-API middleware runs before serving a response.
        </p>
        <SimpleCreateForm
          submitLabel="Consume credits"
          successMessage="Credits consumed."
          action={consumeCredits}
          fields={[
            ...REF_FIELDS,
            { name: "credits", label: "Credits", type: "number", placeholder: "1", required: true },
          ]}
        />
      </Card>
    </>
  );
}
