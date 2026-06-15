import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { fetchAgentService, fetchAgentMetadata } from "@/lib/api";
import { Rating } from "@/app/components/Rating";
import { formatPerCall, formatDate, networkLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

interface AgentPageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: AgentPageProps): Promise<Metadata> {
  const service = await fetchAgentService(params.id);
  if (!service) {
    return { title: "Agent service not found — SettleKit Marketplace" };
  }
  return {
    title: `${service.name} — SettleKit Agent Service`,
    description: service.description,
  };
}

export default async function AgentServiceDetailPage({
  params,
}: AgentPageProps) {
  const [service, metadata] = await Promise.all([
    fetchAgentService(params.id),
    fetchAgentMetadata(params.id),
  ]);
  if (!service || !metadata) notFound();

  return (
    <article>
      <div className="breadcrumb">
        <Link href="/agents">Agent Services</Link> / {service.name}
      </div>

      <div className="detail">
        <div>
          <h1>{service.name}</h1>
          <p className="subtitle">{service.description}</p>

          <div className="tag-row" style={{ marginBottom: 18 }}>
            <span className="pill net">{networkLabel(service.network)}</span>
            <span className="pill">{service.paymentProtocol}</span>
            <span className="pill">{service.currency}</span>
          </div>

          <div className="panel" style={{ marginBottom: 18 }}>
            <h2>Service details</h2>
            <ul className="meta-list">
              <li>
                <span className="k">Seller</span>
                <Link href={`/sellers/${service.merchantSlug}`}>
                  {service.merchantName}
                </Link>
              </li>
              <li>
                <span className="k">Endpoint</span>
                <span>{service.endpoint}</span>
              </li>
              <li>
                <span className="k">Network</span>
                <span>{networkLabel(service.network)}</span>
              </li>
              <li>
                <span className="k">Published</span>
                <span>{formatDate(service.createdAt)}</span>
              </li>
            </ul>
          </div>

          <div className="panel">
            <h2>Agent-readable metadata</h2>
            <p className="subtitle" style={{ fontSize: 13 }}>
              Machine-callable JSON (plan §11). Fetch it directly at{" "}
              <Link href={`/agents/${service.id}/metadata.json`}>
                /agents/{service.id}/metadata.json
              </Link>
              .
            </p>
            <pre className="codeblock">
              {JSON.stringify(metadata, null, 2)}
            </pre>
          </div>
        </div>

        <aside className="panel">
          <div className="price" style={{ fontSize: 26 }}>
            {formatPerCall(service.price)}
          </div>
          <div style={{ margin: "8px 0 16px" }}>
            <Rating
              average={service.ratingAverage}
              count={service.ratingCount}
            />
          </div>
          <a
            className="btn"
            href={`/agents/${service.id}/metadata.json`}
            style={{ width: "100%" }}
          >
            View JSON metadata
          </a>
          <p
            className="subtitle"
            style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}
          >
            Agents pay per call via x402. Validate inputs against the declared
            schema before invoking.
          </p>
        </aside>
      </div>
    </article>
  );
}
