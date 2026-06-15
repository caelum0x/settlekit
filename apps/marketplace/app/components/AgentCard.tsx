import Link from "next/link";
import type { AgentServiceDTO } from "@/lib/types";
import { formatPerCall, networkLabel } from "@/lib/format";
import { Rating } from "./Rating";

interface AgentCardProps {
  service: AgentServiceDTO;
}

/** Summary card for an agent service in the directory grid. */
export function AgentCard({ service }: AgentCardProps) {
  return (
    <Link href={`/agents/${service.id}`} className="card">
      <h3>{service.name}</h3>
      <p>{service.description}</p>
      <div className="tag-row">
        <span className="pill net">{networkLabel(service.network)}</span>
        <span className="pill">{service.paymentProtocol}</span>
        <span className="pill">{service.currency}</span>
      </div>
      <div className="card-foot">
        <span className="price">{formatPerCall(service.price)}</span>
        <Rating average={service.ratingAverage} count={service.ratingCount} />
      </div>
    </Link>
  );
}
