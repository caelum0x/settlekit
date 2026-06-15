import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function BundleDetailPage({
  params,
}: {
  params: { bundleId: string };
}) {
  const { data: bundle, error } = await api.bundles.get(params.bundleId);
  if (!bundle && !error) notFound();

  return (
    <>
      <div className="breadcrumb">
        <Link href="/bundles">Bundles</Link> / {params.bundleId}
      </div>
      <PageHeader
        title={bundle?.name ?? "Bundle"}
        description="Products and pricing included in this bundle."
        action={
          <Link href="/bundles" className="btn">
            ← Back to bundles
          </Link>
        }
      />
      <ErrorBanner error={error} />
      {bundle ? (
        <Card>
          <dl className="detail-grid">
            <dt>Bundle ID</dt>
            <dd className="mono">{bundle.id}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={bundle.status} />
            </dd>
            <dt>Price</dt>
            <dd>{formatMoney(bundle.price)}</dd>
            <dt>Created</dt>
            <dd>{formatDate(bundle.createdAt)}</dd>
            <dt>Included products</dt>
            <dd>
              {bundle.productIds.length === 0 ? (
                <span className="dim">None</span>
              ) : (
                <div className="tag-list">
                  {bundle.productIds.map((id) => (
                    <Link key={id} href={`/products/${id}`} className="tag">
                      {id}
                    </Link>
                  ))}
                </div>
              )}
            </dd>
          </dl>
        </Card>
      ) : (
        <Card>
          <p className="muted">
            Bundle <code>{params.bundleId}</code> could not be loaded.
          </p>
        </Card>
      )}
    </>
  );
}
