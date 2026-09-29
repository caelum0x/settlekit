import Link from "next/link";
import { notFound } from "next/navigation";
import { merchantApi } from "@/lib/merchant-api";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";
import { ProductForm } from "@/components/ProductForm";
import { ShareLink } from "@/components/ShareLink";
import { ProductStatusToggle } from "@/components/ProductStatusToggle";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({ params }: { params: { id: string } }) {
  const [result, profile] = await Promise.all([merchantApi.product(params.id), merchantApi.profile()]);
  if (!result.data && result.error?.includes("404")) notFound();
  const product = result.data;
  const accepted = (profile.data?.networks ?? []).filter((n) => n.accepted);

  return (
    <>
      <div className="breadcrumb">
        <Link href="/products">Products</Link> / {product?.name ?? params.id}
      </div>
      <PageHeader
        title={product?.name ?? "Product"}
        description="Edit the price, delivery and networks. The checkout link stays the same."
        action={product ? <StatusBadge status={product.status} /> : null}
      />
      <ErrorBanner error={result.error} />
      {product ? (
        <>
          {product.slug && product.status === "active" ? (
            <Card title="Share">
              <ShareLink slug={product.slug} productName={product.name} priceUsd={product.priceUsd} />
            </Card>
          ) : null}
          <Card title="Product">
            <ProductForm networks={accepted} product={product} />
          </Card>
          <Card title="Availability">
            <ProductStatusToggle product={product} networks={accepted} />
          </Card>
        </>
      ) : null}
    </>
  );
}
