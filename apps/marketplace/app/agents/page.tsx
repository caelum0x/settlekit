import { fetchAgentServices } from "@/lib/api";
import { AgentCard } from "@/app/components/AgentCard";
import { AgentSearch } from "@/app/components/AgentSearch";
import {
  readNetwork,
  readString,
  type RawSearchParams,
} from "@/lib/search-params";

export const dynamic = "force-dynamic";

interface AgentsPageProps {
  searchParams: RawSearchParams;
}

export default async function AgentServicesPage({
  searchParams,
}: AgentsPageProps) {
  const q = readString(searchParams, "q") ?? "";
  const network = readNetwork(searchParams);
  const minPrice = readString(searchParams, "minPrice") ?? "";
  const maxPrice = readString(searchParams, "maxPrice") ?? "";

  const services = await fetchAgentServices({
    ...(q ? { q } : {}),
    ...(network ? { network } : {}),
    ...(minPrice ? { minPrice } : {}),
    ...(maxPrice ? { maxPrice } : {}),
  });

  return (
    <section>
      <h1>Agent Services</h1>
      <p className="subtitle">
        Machine-callable services priced per request over x402.{" "}
        {services.length} result{services.length === 1 ? "" : "s"}.
      </p>

      <AgentSearch
        q={q}
        network={network ?? ""}
        minPrice={minPrice}
        maxPrice={maxPrice}
      />

      {services.length === 0 ? (
        <div className="empty">
          No agent services match your filters. Try a wider price cap or another
          network.
        </div>
      ) : (
        <div className="grid">
          {services.map((service) => (
            <AgentCard key={service.id} service={service} />
          ))}
        </div>
      )}
    </section>
  );
}
