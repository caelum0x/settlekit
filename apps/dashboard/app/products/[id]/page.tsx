import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatMoney, formatDate, humanize } from "@/lib/format";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: product, error } = await api.products.get(params.id);

  if (!product && !error) notFound();

  return (
    <>
      <div className="breadcrumb">
        <Link href="/products">Products</Link> / {params.id}
      </div>
      <PageHeader
        title={product?.name ?? "Product"}
        description="Configuration and access-delivery wiring for this product."
        action={
          <Link href="/products" className="btn">
            ← Back to products
          </Link>
        }
      />
      <ErrorBanner error={error} />
      {product ? (
        <Card>
          <dl className="detail-grid">
            <dt>Product ID</dt>
            <dd className="mono">{product.id}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={product.status} />
            </dd>
            <dt>What it sells</dt>
            <dd>{humanize(product.sellType)}</dd>
            <dt>Charge model</dt>
            <dd>{humanize(product.chargeModel)}</dd>
            <dt>After payment</dt>
            <dd>{humanize(product.deliveryAction)}</dd>
            <dt>Price</dt>
            <dd>{formatMoney(product.price)}</dd>
            <dt>Created</dt>
            <dd>{formatDate(product.createdAt)}</dd>
          </dl>
        </Card>
      ) : (
        <Card>
          <p className="muted">
            Product <code>{params.id}</code> could not be loaded from the API.
          </p>
        </Card>
      )}
    </>
  );
}
