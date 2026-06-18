/**
 * A thin client over the Arc indexer (services/arc-indexer) used to confirm an
 * x402 payment really landed on chain before serving the gated resource.
 */

/** An on-chain USDC transfer as seen by the indexer. */
export interface IndexedTransfer {
  txHash: string;
  to: string;
  amountUsdc: string;
  network: string;
  confirmations: number;
}

/** Look up settled transfers by hash. */
export interface IndexerClient {
  getTransfer(txHash: string): Promise<IndexedTransfer | null>;
}

/** Options for {@link createFetchIndexerClient}. */
export interface FetchIndexerOptions {
  /** Indexer base URL, e.g. https://arc-indexer.internal. */
  baseUrl: string;
  /** Optional bearer token. */
  apiKey?: string;
  /** Injectable fetch (defaults to global fetch). */
  fetchImpl?: typeof fetch;
}

function asTransfer(value: unknown): IndexedTransfer | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const data = (typeof record["data"] === "object" && record["data"] !== null
    ? (record["data"] as Record<string, unknown>)
    : record) as Record<string, unknown>;

  const txHash = data["txHash"] ?? data["hash"];
  const to = data["to"] ?? data["recipient"] ?? data["destinationAddress"];
  const amountUsdc = data["amountUsdc"] ?? data["amount"];
  const network = data["network"] ?? data["chain"];
  const confirmations = data["confirmations"];

  if (typeof txHash !== "string" || typeof to !== "string" || typeof amountUsdc !== "string") {
    return null;
  }
  return {
    txHash,
    to,
    amountUsdc,
    network: typeof network === "string" ? network : "arc",
    confirmations: typeof confirmations === "number" ? confirmations : 0,
  };
}

/** HTTP indexer client: `GET <baseUrl>/v1/transfers/<txHash>`. */
export function createFetchIndexerClient(options: FetchIndexerOptions): IndexerClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");
  return {
    async getTransfer(txHash: string): Promise<IndexedTransfer | null> {
      const headers: Record<string, string> = {};
      if (options.apiKey !== undefined) {
        headers["Authorization"] = `Bearer ${options.apiKey}`;
      }
      const response = await fetchImpl(`${base}/v1/transfers/${txHash}`, { headers });
      if (!response.ok) {
        return null;
      }
      return asTransfer(await response.json());
    },
  };
}
