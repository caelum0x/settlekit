import {
  entitlementsOfType,
  loadCustomerScope,
} from "@/lib/load";
import type { Entitlement } from "@/lib/types";
import { PageHeader, ErrorNote } from "@/components/PageHeader";
import { DataTable, type Column } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import { DownloadButton } from "@/components/DownloadButton";
import { featureString, formatDate } from "@/lib/format";

/**
 * Downloads page: file entitlements with on-demand signed download links.
 * A fresh HMAC-signed, usage-limited URL is minted by the API per click, so we
 * don't render stale or pre-issued links.
 */
export default async function DownloadsPage({
  params,
}: {
  params: { customerId: string };
}) {
  const customerId = decodeURIComponent(params.customerId);
  const { entitlements, productNames, error } = await loadCustomerScope(customerId);
  const files = entitlementsOfType(entitlements, ["file_access", "private_package"]);

  function fileId(e: Entitlement): string {
    return featureString(e.features, "fileId") ?? e.resourceId ?? e.id;
  }

  function fileName(e: Entitlement): string {
    return (
      featureString(e.features, "filename") ??
      productNames.get(e.productId) ??
      e.productId
    );
  }

  const columns: Column<Entitlement>[] = [
    { key: "file", header: "File", render: (e) => fileName(e) },
    {
      key: "product",
      header: "Product",
      render: (e) => productNames.get(e.productId) ?? e.productId,
    },
    { key: "granted", header: "Granted", render: (e) => formatDate(e.createdAt) },
    {
      key: "status",
      header: "Status",
      render: (e) => <StatusBadge status={e.status} />,
    },
    {
      key: "download",
      header: "Download",
      align: "right",
      render: (e) =>
        e.status === "active" ? (
          <DownloadButton fileId={fileId(e)} customerId={customerId} />
        ) : (
          <span className="muted">Unavailable</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Downloads"
        description="Files you can download. Each link is freshly signed and usage-limited when you request it."
      />
      {error ? <ErrorNote message={error} /> : null}
      <DataTable
        columns={columns}
        rows={files}
        rowKey={(e) => e.id}
        emptyTitle="No downloads"
        emptyBody="Digital files and packages you've bought will appear here with a download link."
      />
    </div>
  );
}
