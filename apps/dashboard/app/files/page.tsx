import { api } from "@/lib/api";
import { formatBytes, formatDate, formatNumber } from "@/lib/format";
import {
  PageHeader,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
} from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const files = await api.files.list();
  return (
    <>
      <PageHeader
        title="Files"
        description="Digital downloads delivered to buyers via signed, expiring URLs."
      />
      <ErrorBanner error={files.error} />
      <Card>
        <DataTable
          rows={files.data}
          getKey={(f) => f.id}
          empty={
            <EmptyState
              title="No files uploaded"
              message="Upload assets and attach them to a product with the “Unlock file download” delivery action."
            />
          }
          columns={[
            { header: "Filename", cell: (f) => <span className="mono">{f.filename}</span> },
            { header: "Type", cell: (f) => <span className="tag">{f.contentType}</span> },
            { header: "Size", cell: (f) => formatBytes(f.size) },
            { header: "Downloads", cell: (f) => formatNumber(f.downloads) },
            { header: "Uploaded", cell: (f) => formatDate(f.createdAt) },
          ]}
        />
      </Card>
    </>
  );
}
