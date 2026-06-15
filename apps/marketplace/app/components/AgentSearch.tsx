interface AgentSearchProps {
  q: string;
  network: string;
  maxPrice: string;
}

/**
 * Search + network + max-price controls for the agent directory. Plain GET form
 * so the directory is filterable with real query params and no client JS.
 */
export function AgentSearch({ q, network, maxPrice }: AgentSearchProps) {
  return (
    <form className="searchbar" method="get" action="/agents">
      <input
        type="search"
        name="q"
        placeholder="Search agent services…"
        defaultValue={q}
        aria-label="Search agent services"
      />
      <select name="network" defaultValue={network} aria-label="Network">
        <option value="">All networks</option>
        <option value="arc">Arc</option>
        <option value="base">Base</option>
      </select>
      <input
        type="text"
        name="maxPrice"
        placeholder="Max $/call"
        defaultValue={maxPrice}
        aria-label="Maximum price per call"
        inputMode="decimal"
        style={{ maxWidth: 130 }}
      />
      <button className="btn" type="submit">
        Filter
      </button>
    </form>
  );
}
