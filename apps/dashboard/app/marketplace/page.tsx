import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  StatusBadge,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";
import { SimpleCreateForm } from "@/components/forms/SimpleCreateForm";

export const dynamic = "force-dynamic";

/**
 * Publish a product to the public marketplace: create a listing for it, then
 * publish it so it becomes discoverable. Both calls hit the real API
 * (`/v1/marketplace/listings` + `/publish`), which persists to Postgres.
 */
async function publishToMarketplace(values: Record<string, string>): Promise<string | null> {
  "use server";
  const tags = (values.tags ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const { data: listing, error } = await api.marketplace.create({
    organizationId: values.organizationId ?? "",
    merchantId: values.merchantId ?? "",
    productId: values.productId ?? "",
    title: values.title ?? "",
    summary: values.summary ?? "",
    tags,
  });
  if (error || !listing) return error ?? "Failed to create listing.";
  const { error: publishError } = await api.marketplace.publish(listing.id);
  return publishError;
}

export default async function MarketplacePage() {
  const listings = await api.marketplace.listings();

  return (
    <>
      <PageHeader
        title="Marketplace"
        description="Publish your products to the public SettleKit marketplace so buyers and AI agents can discover them."
      />
      <ErrorBanner error={listings.error} />

      <Card title="Published & draft listings">
        <DataTable
          rows={listings.data}
          getKey={(l) => l.id}
          empty={
            <EmptyState
              title="No marketplace listings yet"
              message="Publish a product below to list it in the public marketplace."
            />
          }
          columns={[
            { header: "Title", cell: (l) => l.title },
            {
              header: "Tags",
              cell: (l) => (
                <div className="tag-list">
                  {l.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              ),
            },
            {
              header: "Rating",
              cell: (l) => (l.ratingCount > 0 ? `${l.ratingAverage.toFixed(1)} (${l.ratingCount})` : "—"),
            },
            {
              header: "Status",
              cell: (l) => <StatusBadge status={l.published ? "published" : "draft"} />,
            },
            { header: "Created", cell: (l) => formatDate(l.createdAt) },
          ]}
        />
      </Card>

      <Card title="Publish a product">
        <p className="muted">
          Enter a product you've created (see <Link href="/products">Products</Link>) to list it
          publicly. The listing is created and published in one step.
        </p>
        <SimpleCreateForm
          submitLabel="Publish to marketplace"
          successMessage="Listing published to the marketplace."
          action={publishToMarketplace}
          fields={[
            { name: "productId", label: "Product ID", required: true, placeholder: "prod_…" },
            { name: "merchantId", label: "Merchant ID", required: true, placeholder: "mch_…" },
            { name: "organizationId", label: "Organization ID", required: true, placeholder: "org_…" },
            { name: "title", label: "Listing title", required: true, placeholder: "AI SaaS Boilerplate Pro" },
            { name: "summary", label: "Summary", type: "textarea", required: true, placeholder: "What buyers get…" },
            { name: "tags", label: "Tags (comma-separated)", placeholder: "nextjs, saas, usdc" },
          ]}
        />
      </Card>
    </>
  );
}
