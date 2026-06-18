/**
 * The publisher side: x402-gated Fetch handlers that serve gated content and,
 * on each paid access, compute and emit the recursive royalty distribution.
 */

import type { PaymentVerifier } from "@settlekit/x402";
import { withSettleKitPayment } from "@settlekit/x402";
import type { PlatformFeeSchedule } from "@settlekit/platform-billing";
import type { SourceRegistry } from "./registry.js";
import { NANO_FEE_SCHEDULE, computeRoyaltyDistribution } from "./splits.js";
import type { RoyaltyDistribution, Source } from "./types.js";

/** Invoked after a successful paid access with the computed royalty split. Wire
 * this to a settler/ledger or to @settlekit/payouts to actually pay authors. */
export type RoyaltyDistributor = (
  distribution: RoyaltyDistribution,
  source: Source,
) => void | Promise<void>;

/** Configuration shared by all source handlers in a toll deployment. */
export interface CitationTollConfig {
  /** x402 verifier confirming the payer's proof (e.g. the local settlement
   * verifier, or an on-chain Arc verifier). */
  verify: PaymentVerifier;
  /** Platform fee schedule. Defaults to the nanopayment schedule (2.5%, no fixed). */
  schedule?: PlatformFeeSchedule;
  /** Called after each paid access to settle the author/ancestor split. */
  distributor?: RoyaltyDistributor;
  /** Override the address tolls are paid to. Defaults to each source's author
   * wallet (which then funds the recursive ancestor split). */
  collectorAddress?: string;
}

function contentResponse(source: Source): Response {
  return Response.json({
    id: source.id,
    title: source.title,
    body: source.body,
    citedFrom: source.cites.map((c) => c.sourceId),
  });
}

/** Build an x402-gated handler for a single source. */
export function createSourceHandler(
  source: Source,
  registry: SourceRegistry,
  config: CitationTollConfig,
): (request: Request) => Promise<Response> {
  const schedule = config.schedule ?? NANO_FEE_SCHEDULE;
  return withSettleKitPayment({
    price: source.priceUsdc,
    currency: "USDC",
    network: source.network === "base" ? "base" : "arc",
    payTo: config.collectorAddress ?? source.authorWallet,
    productId: source.id,
    verify: config.verify,
    settleAndMeter: async () => {
      if (config.distributor === undefined) {
        return;
      }
      const distribution = computeRoyaltyDistribution(registry, source.id, schedule);
      if (distribution !== undefined) {
        await config.distributor(distribution, source);
      }
    },
  })(() => contentResponse(source));
}

function parseSourceId(url: string): string | undefined {
  const { pathname, searchParams } = new URL(url);
  const query = searchParams.get("source");
  if (query !== null && query.length > 0) {
    return query;
  }
  const segments = pathname.split("/").filter((s) => s.length > 0);
  const last = segments.at(-1);
  return last !== undefined && last !== "articles" ? last : undefined;
}

/**
 * Build a router that serves every source in the registry. Routes
 * `GET <base>/articles/<id>` (or `?source=<id>`) to the matching x402-gated
 * handler; unknown ids return 404.
 */
export function createCitationTollRouter(
  registry: SourceRegistry,
  config: CitationTollConfig,
): (request: Request) => Promise<Response> {
  const handlers = new Map<string, (request: Request) => Promise<Response>>();

  const handlerFor = (source: Source): ((request: Request) => Promise<Response>) => {
    const cached = handlers.get(source.id);
    if (cached !== undefined) {
      return cached;
    }
    const built = createSourceHandler(source, registry, config);
    handlers.set(source.id, built);
    return built;
  };

  return async function route(request: Request): Promise<Response> {
    const id = parseSourceId(request.url);
    if (id === undefined) {
      return Response.json({ error: "not_found", reason: "no source id" }, { status: 404 });
    }
    const source = registry.get(id);
    if (source === undefined) {
      return Response.json({ error: "not_found", reason: `unknown source ${id}` }, { status: 404 });
    }
    return handlerFor(source)(request);
  };
}
