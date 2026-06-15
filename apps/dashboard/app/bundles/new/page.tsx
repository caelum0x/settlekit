import { api } from "@/lib/api";
import { PageHeader, Card } from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

async function createBundle(values: Record<string, string>): Promise<string | null> {
  "use server";
  const productIds = (values.productIds ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const amount = Math.round((parseFloat(values.amount || "0") || 0) * 1_000_000);
  const { error } = await api.bundles.create(values.name ?? "", productIds, amount);
  return error;
}

export default async function NewBundlePage() {
  // Load products so the merchant can see which IDs are available to bundle.
  const products = await api.products.list();
  return (
    <>
      <div className="breadcrumb">
        <a href="/bundles">Bundles</a> / New
      </div>
      <PageHeader
        title="New Bundle"
        description="Group existing products into a single offer with one price."
      />
      <Card title="Bundle details">
        <SimpleCreateForm
          submitLabel="Create bundle"
          successMessage="Bundle created."
          action={createBundle}
          fields={[
            { name: "name", label: "Bundle name", required: true, placeholder: "Developer Starter Kit" },
            {
              name: "productIds",
              label: "Product IDs",
              required: true,
              placeholder: "prod_1, prod_2, prod_3",
              hint:
                products.data.length > 0
                  ? `Available: ${products.data.map((p) => p.id).join(", ")}`
                  : "Create products first, then reference their IDs here.",
            },
            { name: "amount", label: "Bundle price (USDC)", type: "number", required: true, placeholder: "99.00" },
          ]}
        />
      </Card>
    </>
  );
}
