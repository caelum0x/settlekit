import Link from "next/link";
import { notFound } from "next/navigation";
import { api, API_URL } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { PageHeader, Card, StatusBadge, ErrorBanner } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AgentServiceDetailPage({
  params,
}: {
  params: { serviceId: string };
}) {
  const { data: service, error } = await api.agentServices.get(params.serviceId);
  if (!service && !error) notFound();

  return (
    <>
      <div className="breadcrumb">
        <Link href="/agent-services">Agent Services</Link> / {params.serviceId}
      </div>
      <PageHeader
        title={service?.name ?? "Agent Service"}
        description="Per-call service configuration and agent-readable metadata."
        action={
          <Link href="/agent-services" className="btn">
            ← Back
          </Link>
        }
      />
      <ErrorBanner error={error} />
      {service ? (
        <>
          <Card>
            <dl className="detail-grid">
              <dt>Service ID</dt>
              <dd className="mono">{service.id}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={service.status} />
              </dd>
              <dt>Endpoint</dt>
              <dd className="mono">{service.endpoint}</dd>
              <dt>Price per call</dt>
              <dd>{formatMoney(service.pricePerCall)}</dd>
              <dt>Description</dt>
              <dd>{service.description}</dd>
            </dl>
          </Card>
          <Card title="Agent-readable metadata">
            <p className="muted">
              Agents discover this service at:
            </p>
            <p className="mono">
              {API_URL}/v1/agent-services/{service.id}/metadata.json
            </p>
          </Card>
        </>
      ) : (
        <Card>
          <p className="muted">
            Service <code>{params.serviceId}</code> could not be loaded.
          </p>
        </Card>
      )}
    </>
  );
}
