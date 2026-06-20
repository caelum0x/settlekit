/**
 * The agent console's data layer.
 *
 * This is NOT mocked JSON — it drives the real SettleKit spine so the UI shows
 * exactly what the domain produces when autonomous agents do commerce:
 *
 *  - the marketplace is built with @settlekit/agent-services `createAgentService`
 *    + `publishAgentService`, then surfaced via `discoverPublishedAgentServices`;
 *  - every simulated agent invocation runs through `recordAgentUsage` /
 *    `agentUsageCost`, the same per-call x402 metering the gateway uses, and we
 *    aggregate per-agent and per-service spend with `addMoney`;
 *  - reputation is folded from real star ratings with `aggregateAgentReputation`;
 *  - the citation toll uses @settlekit/citation-toll `createSource` +
 *    `computeRoyaltyDistribution`, the same recursive split the toll handler
 *    produces, so a cited source pays its author and fans a share onward to its
 *    own ancestors;
 *  - the proofs panel runs @settlekit/attribution `detectReuse` over the source
 *    corpus and issues a real signed proof-of-citation.
 *
 * A fixed clock + fixed integer counts make the dataset deterministic across
 * renders. The proof `nonce`/`signature` (randomUUID) are the only
 * non-deterministic fields — by design. Swap this module for the Pg-backed
 * stores to go live.
 */

import { type Money, type Result, addMoney, isOk, money } from "@settlekit/common";
import {
  type AgentService,
  type AgentReadableMetadata,
  type CreateAgentServiceInput,
  aggregateAgentReputation,
  agentRequestPrice,
  agentUsageCost,
  createAgentService,
  discoverPublishedAgentServices,
  generateAgentMetadata,
  publishAgentService,
  ratingAverage,
  recordAgentUsage,
} from "@settlekit/agent-services";
import {
  InMemorySourceRegistry,
  type Citation,
  type CreateSourceInput,
  type RoyaltyLeg,
  type Source,
  computeRoyaltyDistribution,
  createSource,
} from "@settlekit/citation-toll";
import {
  type CitationProof,
  type ReuseMatch,
  detectReuse,
  issueCitationProof,
} from "@settlekit/attribution";
import {
  type AgentIdentity,
  LocalErc8004Port,
  configureErc8004,
} from "@settlekit/erc8004";
import {
  type Job,
  type JobStatus,
  type JobTransition,
  LocalErc8183Port,
  configureErc8183,
} from "@settlekit/erc8183";

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

const CLOCK = new Date("2026-06-18T09:00:00.000Z");
const ORG_ID = "org_agent_console_demo";
const PROOF_SECRET = process.env.CITATION_PROOF_SECRET ?? "dev-citation-proof-secret";

function sum(amounts: readonly Money[]): Money {
  return amounts.reduce<Money>((acc, m) => addMoney(acc, m), money("0"));
}

/* -------------------------------------------------------------------------- */
/* Seed: agent-services published to the marketplace                          */
/* -------------------------------------------------------------------------- */

interface ServiceSeed {
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  /** Per-request price in USDC major units (<=6dp). */
  price: string;
  network: "arc" | "base";
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  /** Star ratings (each an integer in [1,5]) folded into reputation. */
  ratings: number[];
}

const SERVICE_SEEDS: readonly ServiceSeed[] = [
  {
    slug: "embed",
    name: "NanoEmbed v2",
    description: "Sub-cent text embeddings priced per request, settled over x402.",
    endpoint: "https://embed.agents.settlekit.dev/v2/embed",
    price: "0.0004",
    network: "base",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    outputSchema: { type: "object", properties: { vector: { type: "array" } } },
    ratings: [5, 5, 4, 5, 4, 5],
  },
  {
    slug: "rerank",
    name: "Citation Reranker",
    description: "Reranks candidate sources by grounding strength for citation tolls.",
    endpoint: "https://rerank.agents.settlekit.dev/v1/rerank",
    price: "0.0007",
    network: "base",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, candidates: { type: "array" } },
      required: ["query", "candidates"],
    },
    ratings: [4, 5, 4, 4, 3],
  },
  {
    slug: "summarize",
    name: "Provenance Summarizer",
    description: "Summarizes a source and emits the citation lineage it was grounded in.",
    endpoint: "https://summarize.agents.settlekit.dev/v1/summarize",
    price: "0.0009",
    network: "arc",
    inputSchema: { type: "object", properties: { sourceId: { type: "string" } }, required: ["sourceId"] },
    ratings: [5, 4, 5, 5],
  },
  {
    slug: "detect",
    name: "Reuse Detector API",
    description: "Detects which gated sources an agent answer was grounded in (implicit reuse).",
    endpoint: "https://detect.agents.settlekit.dev/v1/detect",
    price: "0.0005",
    network: "arc",
    inputSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
    ratings: [5, 5, 5, 4, 5, 4, 5],
  },
];

/* -------------------------------------------------------------------------- */
/* Seed: autonomous agents that invoke the services                           */
/* -------------------------------------------------------------------------- */

interface AgentSeed {
  id: string;
  name: string;
  /** Per-agent monthly x402 budget cap, USDC major units. */
  budgetUsdc: string;
  /** Deterministic integer request counts, keyed by service slug. */
  requests: Record<string, number>;
}

const AGENT_SEEDS: readonly AgentSeed[] = [
  {
    id: "agent_atlas",
    name: "Atlas Researcher",
    budgetUsdc: "5.000000",
    requests: { embed: 1800, rerank: 600, summarize: 200, detect: 320 },
  },
  {
    id: "agent_scout",
    name: "Scout Indexer",
    budgetUsdc: "2.000000",
    requests: { embed: 2400, detect: 140 },
  },
  {
    id: "agent_juno",
    name: "Juno Synthesizer",
    budgetUsdc: "3.500000",
    requests: { rerank: 480, summarize: 360, detect: 260 },
  },
];

/* -------------------------------------------------------------------------- */
/* Seed: citeable sources for the citation toll / proof example               */
/* -------------------------------------------------------------------------- */

interface SourceSeed {
  slug: string;
  title: string;
  authorWallet: string;
  priceUsdc: string;
  summary: string;
  body: string;
  cites?: { slug: string; shareBps: number }[];
}

const SOURCE_SEEDS: readonly SourceSeed[] = [
  {
    slug: "primer",
    title: "The Recursive Settlement Primer",
    authorWallet: "0xada0000000000000000000000000000000000001",
    priceUsdc: "0.0009",
    summary: "Why royalties should follow a work through every hand that cites it.",
    body:
      "Royalties should follow a work through every hand that made it. When settlement is sub-cent " +
      "and gas-free, a citation can pay its source automatically, and that payment can fan out " +
      "recursively to everything the source itself was grounded in.",
  },
  {
    slug: "x402",
    title: "Paying Agent-Services over x402",
    authorWallet: "0xb00000000000000000000000000000000000000b",
    priceUsdc: "0.0008",
    summary: "How an agent reads a §11 metadata doc and pays per call via x402.",
    body:
      "An agent discovers a service, reads its machine-readable metadata, and pays a fraction of a " +
      "cent per request via x402. The toll is batched into one on-chain settlement and the recursive " +
      "split routes a share back to the primer it was grounded in.",
    cites: [{ slug: "primer", shareBps: 3500 }],
  },
  {
    slug: "tolls",
    title: "Agent Citation Tolls at the Boundary",
    authorWallet: "0xc1d000000000000000000000000000000000000c",
    priceUsdc: "0.0007",
    summary: "Charging implicit reuse, not just deliberate fetches.",
    body:
      "Reuse detection closes the loop: given the text an agent produced, detect which sources it was " +
      "grounded in and charge the toll, then settle recursively through the citation lineage over x402.",
    cites: [{ slug: "x402", shareBps: 3000 }],
  },
];

/* -------------------------------------------------------------------------- */
/* Build: marketplace                                                          */
/* -------------------------------------------------------------------------- */

function createServiceOrThrow(input: CreateAgentServiceInput): AgentService {
  const r = createAgentService(input, CLOCK);
  if (!isOk(r)) throw new Error(`createAgentService failed in seed: ${r.error.message}`);
  return r.value;
}

interface BuiltService {
  seed: ServiceSeed;
  service: AgentService;
}

function buildMarketplace(): BuiltService[] {
  return SERVICE_SEEDS.map((seed) => {
    const created = createServiceOrThrow({
      organizationId: ORG_ID,
      merchantId: `mer_${seed.slug}`,
      productId: `prod_${seed.slug}`,
      name: seed.name,
      description: seed.description,
      endpoint: seed.endpoint,
      price: seed.price,
      network: seed.network,
      inputSchema: seed.inputSchema,
      ...(seed.outputSchema ? { outputSchema: seed.outputSchema } : {}),
    });
    return { seed, service: publishAgentService(created) };
  });
}

/* -------------------------------------------------------------------------- */
/* Build: source graph (citation toll)                                        */
/* -------------------------------------------------------------------------- */

function createSourceOrThrow(input: CreateSourceInput): Source {
  const r = createSource(input, CLOCK);
  if (!isOk(r)) throw new Error(`createSource failed in seed: ${r.error.message}`);
  return r.value;
}

function buildRegistry(): { registry: InMemorySourceRegistry; bySlug: Map<string, Source> } {
  const registry = new InMemorySourceRegistry();
  const bySlug = new Map<string, Source>();

  // Originals first so derived works can cite their ids.
  const ordered = [...SOURCE_SEEDS].sort((a, b) => (a.cites ? 1 : 0) - (b.cites ? 1 : 0));
  for (const seed of ordered) {
    const cites: Citation[] = (seed.cites ?? []).map((c) => {
      const parent = bySlug.get(c.slug);
      if (parent === undefined) throw new Error(`source seed ${seed.slug} cites unknown ${c.slug}`);
      return { sourceId: parent.id, shareBps: c.shareBps };
    });
    const created = createSourceOrThrow({
      organizationId: ORG_ID,
      title: seed.title,
      authorWallet: seed.authorWallet,
      priceUsdc: seed.priceUsdc,
      body: seed.body,
      summary: seed.summary,
      cites,
    });
    registry.add(created);
    bySlug.set(seed.slug, created);
  }
  return { registry, bySlug };
}

/* -------------------------------------------------------------------------- */
/* Row types exported for the pages                                            */
/* -------------------------------------------------------------------------- */

export interface ServiceListing {
  id: string;
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  price: string;
  priceUsdc: string;
  network: "arc" | "base";
  paymentProtocol: "x402";
  ratingAverage: number;
  ratingCount: number;
  /** Aggregate requests across all agents against this service. */
  requests: number;
  /** Aggregate x402 spend across all agents against this service. */
  revenue: Money;
  metadata: AgentReadableMetadata;
}

export interface AgentStat {
  id: string;
  name: string;
  budgetUsdc: string;
  requests: number;
  /** Total x402 spend across every service this agent invoked. */
  spent: Money;
  /** Fraction of budget consumed, in [0, 1] (clamped). */
  budgetUsedPct: number;
  /** Distinct services invoked by this agent. */
  servicesUsed: number;
  /** Proofs-of-citation this agent has presented. */
  proofsPresented: number;
}

export interface ActivityRow {
  id: string;
  agentName: string;
  serviceName: string;
  network: "arc" | "base";
  units: number;
  amount: Money;
  createdAt: string;
}

export interface RoyaltyLegRow extends RoyaltyLeg {
  sourceTitle: string;
}

export interface CitationExample {
  /** The accessed source whose toll is distributed. */
  sourceTitle: string;
  gross: Money;
  platformFee: Money;
  distributable: Money;
  legs: RoyaltyLegRow[];
  /** Worked reuse-detection example. */
  answer: string;
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  tollOwedUsdc: string;
  proof: CitationProof;
}

export interface ConsoleTotals {
  agentsActive: number;
  servicesDiscovered: number;
  totalSpend: Money;
  citationsMade: number;
  proofsIssued: number;
}

export interface AgentConsoleContext {
  totals: ConsoleTotals;
  agents: AgentStat[];
  services: ServiceListing[];
  activity: ActivityRow[];
  citations: CitationExample;
}

/* -------------------------------------------------------------------------- */
/* Aggregate everything                                                        */
/* -------------------------------------------------------------------------- */

export function getAgentConsoleContext(): AgentConsoleContext {
  const built = buildMarketplace();
  const published = discoverPublishedAgentServices(built.map((b) => b.service));
  const bySlug = new Map(built.map((b) => [b.seed.slug, b]));

  // Simulate every agent invoking every service it has a request count for.
  // recordAgentUsage gives us the canonical x402 usage event per (agent, service).
  const activity: ActivityRow[] = [];
  const perServiceRequests = new Map<string, number>();
  const perServiceRevenue = new Map<string, Money>();
  const agents: AgentStat[] = [];

  let seq = 0;
  for (const agentSeed of AGENT_SEEDS) {
    const amounts: Money[] = [];
    let agentRequests = 0;
    let servicesUsed = 0;

    for (const [slug, units] of Object.entries(agentSeed.requests)) {
      const target = bySlug.get(slug);
      if (target === undefined || units <= 0) continue;
      const usage = recordAgentUsage(
        target.service,
        agentSeed.id,
        units,
        new Date(CLOCK.getTime() + seq * 1000),
      );
      seq++;
      servicesUsed++;
      agentRequests += units;
      amounts.push(usage.amount);

      perServiceRequests.set(slug, (perServiceRequests.get(slug) ?? 0) + units);
      perServiceRevenue.set(slug, addMoney(perServiceRevenue.get(slug) ?? money("0"), usage.amount));

      activity.push({
        id: usage.id,
        agentName: agentSeed.name,
        serviceName: target.seed.name,
        network: target.service.network,
        units: usage.units,
        amount: usage.amount,
        createdAt: usage.createdAt,
      });
    }

    const spent = sum(amounts);
    const budget = Number(agentSeed.budgetUsdc);
    const budgetUsedPct =
      budget > 0 ? Math.min(1, Number(spent.amount) / budget) : 0;

    agents.push({
      id: agentSeed.id,
      name: agentSeed.name,
      budgetUsdc: agentSeed.budgetUsdc,
      requests: agentRequests,
      spent,
      budgetUsedPct,
      servicesUsed,
      proofsPresented: 0, // filled in below once proofs are known
    });
  }

  // Build service listings with real reputation aggregation.
  const services: ServiceListing[] = built.map((b) => {
    const reputation = aggregateAgentReputation(b.service.id, b.seed.ratings);
    return {
      id: b.service.id,
      slug: b.seed.slug,
      name: b.service.name,
      description: b.service.description,
      endpoint: b.service.endpoint,
      price: b.service.price,
      priceUsdc: agentRequestPrice(b.service.price).amount,
      network: b.service.network,
      paymentProtocol: b.service.paymentProtocol,
      ratingAverage: ratingAverage(reputation.ratingTotal, reputation.ratingCount),
      ratingCount: reputation.ratingCount,
      requests: perServiceRequests.get(b.seed.slug) ?? 0,
      revenue: perServiceRevenue.get(b.seed.slug) ?? money("0"),
      metadata: generateAgentMetadata(b.service),
    };
  });

  const citations = buildCitationExample();

  // Attribute proofs to agents deterministically: the agent named in the proof
  // plus a fixed deterministic spread across agents for the demo.
  const proofsIssued = 1;
  const agentsWithProofs = agents.map((a, i) => ({
    ...a,
    proofsPresented: i === 0 ? proofsIssued : 0,
  }));

  const totalSpend = sum(agentsWithProofs.map((a) => a.spent));

  // Most recent activity first.
  const recentActivity = [...activity]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 25);

  return {
    totals: {
      agentsActive: agentsWithProofs.length,
      servicesDiscovered: published.length,
      totalSpend,
      citationsMade: citations.matches.length,
      proofsIssued,
    },
    agents: agentsWithProofs,
    services,
    activity: recentActivity,
    citations,
  };
}

/* -------------------------------------------------------------------------- */
/* Citation worked example (real toll distribution + reuse + signed proof)    */
/* -------------------------------------------------------------------------- */

function candidatesFromRegistry(
  registry: InMemorySourceRegistry,
): { id: string; text: string; wallet: string }[] {
  return registry.all().map((s) => ({
    id: s.id,
    text: [s.title, s.summary, s.body].join(". "),
    wallet: s.authorWallet,
  }));
}

function buildCitationExample(): CitationExample {
  const { registry, bySlug } = buildRegistry();
  const titleById = new Map(registry.all().map((s) => [s.id, s.title]));

  // The accessed source whose toll fans out recursively (cites -> x402 -> primer).
  const accessed = bySlug.get("tolls");
  if (accessed === undefined) throw new Error("citation example: missing accessed source");
  const distribution = computeRoyaltyDistribution(registry, accessed.id);
  if (distribution === undefined) throw new Error("citation example: distribution undefined");

  const legs: RoyaltyLegRow[] = distribution.legs.map((leg) => ({
    ...leg,
    sourceTitle: titleById.get(leg.sourceId) ?? leg.sourceId,
  }));

  // Reuse detection over the corpus for a representative agent answer.
  const answer =
    "Royalties should follow a work through every hand that made it, and when settlement is " +
    "sub-cent and gas-free a citation can pay its source automatically.";
  const report = detectReuse(answer, candidatesFromRegistry(registry));
  const matches = report.matches.map((m) => ({
    ...m,
    title: titleById.get(m.sourceId) ?? m.sourceId,
  }));
  const tollOwed = sum(
    report.matches.map((m) => {
      const s = registry.get(m.sourceId);
      return s !== undefined ? money(s.priceUsdc) : money("0");
    }),
  );

  const proof = issueCitationProof(
    {
      agent: "agent_atlas",
      sourceIds: report.matches.map((m) => m.sourceId),
      accessId: "acc_atlas_1",
      amountUsdc: tollOwed.amount,
      ttlSeconds: 3600,
    },
    PROOF_SECRET,
    CLOCK,
  );

  return {
    sourceTitle: accessed.title,
    gross: distribution.gross,
    platformFee: distribution.platformFee,
    distributable: distribution.distributable,
    legs,
    answer,
    grounded: report.grounded,
    matches,
    tollOwedUsdc: tollOwed.amount,
    proof,
  };
}

/* -------------------------------------------------------------------------- */
/* Interactive helper for the /api/detect route                                */
/* -------------------------------------------------------------------------- */

/** Run reuse detection for arbitrary text against the demo source corpus. */
export function detectGroundingForText(text: string): {
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
} {
  const { registry } = buildRegistry();
  const report = detectReuse(text, candidatesFromRegistry(registry));
  const titleById = new Map(registry.all().map((s) => [s.id, s.title]));
  const matches = report.matches.map((m) => ({
    ...m,
    title: titleById.get(m.sourceId) ?? m.sourceId,
  }));
  const quote = sum(
    report.matches.map((m) => {
      const s = registry.get(m.sourceId);
      return s !== undefined ? money(s.priceUsdc) : money("0");
    }),
  );
  return { grounded: report.grounded, matches, quoteUsdc: quote.amount };
}

/* ========================================================================== */
/* ERC-8004 — agent identity, reputation & validation                          */
/* ========================================================================== */

/*
 * These builders drive the REAL @settlekit/erc8004 / @settlekit/erc8183 clients
 * over their deterministic LOCAL ports (no chain, no Date.now, no Math.random).
 * Every client method is async and returns a Result, so the builders are async
 * and unwrap each Result with isOk — throwing inside the seed on failure, the
 * same discipline buildMarketplace() uses with createServiceOrThrow.
 *
 * resolveAgent caveat: LocalErc8004Port.findAgentId returns the FIRST agent for
 * an owner, so we instantiate ONE port per distinct owner to keep every minted
 * identity resolvable by its owner wallet.
 */

interface AgentIdentitySeed {
  /** Owner wallet that mints + owns the identity (one local port per owner). */
  owner: string;
  /** Metadata URI describing the agent (validated non-empty by the client). */
  metadataUri: string;
  /** Validator wallet that attests the agent (non-empty address). */
  validator: string;
  /** Reputation feedback scores, each 0..100, folded into the summary. */
  ratings: number[];
  /** Validation request descriptor + verdict response (100 => passed). */
  validation: { requestUri: string; subject: string; response: number };
}

const AGENT_IDENTITY_SEEDS: readonly AgentIdentitySeed[] = [
  {
    owner: "0xa9e0000000000000000000000000000000000a01",
    metadataUri: "ipfs://agent/atlas-researcher.json",
    validator: "0xva1d000000000000000000000000000000000001",
    ratings: [92, 88, 95, 90],
    validation: {
      requestUri: "ipfs://validation/atlas-request.json",
      subject: "atlas-researcher:capability-attestation",
      response: 100,
    },
  },
  {
    owner: "0xb70000000000000000000000000000000000000b",
    metadataUri: "ipfs://agent/scout-indexer.json",
    validator: "0xva1d000000000000000000000000000000000002",
    ratings: [78, 84, 80],
    validation: {
      requestUri: "ipfs://validation/scout-request.json",
      subject: "scout-indexer:capability-attestation",
      response: 60,
    },
  },
];

/** One reputation/identity row rendered by the /agents identity table. */
export interface AgentIdentityRow {
  agentId: string;
  owner: string;
  metadataUri: string;
  /** Mean of the recorded feedback scores (0..100), rounded to 1dp. */
  avgScore: number;
  feedbackCount: number;
  /** True when the validator responded with a passing verdict. */
  validationPassed: boolean;
  /** Raw validator response (0..100). */
  validationResponse: number;
  /** On-chain request hash for the validation. */
  requestHash: string;
  /** Status string for the StatusBadge: "granted" (passed) or "pending". */
  validationStatus: "granted" | "pending";
}

export interface AgentIdentityTotals {
  agentsRegistered: number;
  ownerWallets: number;
  validationsPassed: number;
  validationsTotal: number;
  avgReputation: number;
}

export interface AgentIdentityContext {
  totals: AgentIdentityTotals;
  agents: AgentIdentityRow[];
}

/** Unwrap an erc8004/erc8183 Result inside a seed, throwing on failure. */
function unwrap<T>(label: string, r: Result<T>): T {
  if (!isOk(r)) throw new Error(`${label} failed in seed: ${r.error.message}`);
  return r.value;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((acc, n) => acc + n, 0);
  return Math.round((total / values.length) * 10) / 10;
}

/**
 * Register the demo agents through the REAL AgentRegistryClient, record their
 * reputation feedback, run a validation request/response per agent, and project
 * the result into rows for the identity view. Deterministic across renders.
 */
export async function getAgentIdentityContext(): Promise<AgentIdentityContext> {
  const rows: AgentIdentityRow[] = [];

  for (const seed of AGENT_IDENTITY_SEEDS) {
    // One port per owner so resolveAgent(owner) maps to THIS agent.
    const port = new LocalErc8004Port({ owner: seed.owner });
    const registry = configureErc8004({ port });

    unwrap("registerAgent", await registry.registerAgent({ metadataUri: seed.metadataUri }));

    const identity = unwrap<AgentIdentity | null>(
      "resolveAgent",
      await registry.resolveAgent({ owner: seed.owner }),
    );
    if (identity === null) throw new Error(`resolveAgent returned null for ${seed.owner}`);

    for (const score of seed.ratings) {
      unwrap(
        "giveFeedback",
        await registry.giveFeedback({
          agentId: identity.agentId,
          score,
          tag: "task_completion",
        }),
      );
    }

    const request = unwrap(
      "requestValidation",
      await registry.requestValidation({
        agentId: identity.agentId,
        validator: seed.validator,
        requestUri: seed.validation.requestUri,
        subject: seed.validation.subject,
      }),
    );
    unwrap(
      "respondValidation",
      await registry.respondValidation({
        requestHash: request.requestHash,
        response: seed.validation.response,
        tag: "capability",
      }),
    );
    const status = unwrap(
      "getValidationStatus",
      await registry.getValidationStatus({ requestHash: request.requestHash }),
    );

    rows.push({
      agentId: identity.agentId,
      owner: identity.owner,
      metadataUri: identity.metadataUri,
      avgScore: mean(seed.ratings),
      feedbackCount: seed.ratings.length,
      validationPassed: status.passed,
      validationResponse: status.response,
      requestHash: request.requestHash,
      validationStatus: status.passed ? "granted" : "pending",
    });
  }

  const passed = rows.filter((r) => r.validationPassed).length;
  return {
    totals: {
      agentsRegistered: rows.length,
      ownerWallets: new Set(rows.map((r) => r.owner)).size,
      validationsPassed: passed,
      validationsTotal: rows.length,
      avgReputation: mean(rows.map((r) => r.avgScore)),
    },
    agents: rows,
  };
}

/* ========================================================================== */
/* ERC-8183 — autonomous-agent job lifecycle                                   */
/* ========================================================================== */

interface JobSeed {
  requester: string;
  worker: string;
  /** Decimal USDC (no thousands separators, <=6dp) — matches AMOUNT_RE. */
  amountUsdc: string;
  specUri: string;
  deliverableUri: string;
}

const JOB_SEEDS: readonly JobSeed[] = [
  {
    requester: "0xreq0000000000000000000000000000000000001",
    worker: "0xwrk0000000000000000000000000000000000001",
    amountUsdc: "120.00",
    specUri: "ipfs://jobs/spec-corpus-embedding.json",
    deliverableUri: "ipfs://jobs/deliverable-corpus-embedding.json",
  },
  {
    requester: "0xreq0000000000000000000000000000000000002",
    worker: "0xwrk0000000000000000000000000000000000002",
    amountUsdc: "85.50",
    specUri: "ipfs://jobs/spec-provenance-report.json",
    deliverableUri: "ipfs://jobs/deliverable-provenance-report.json",
  },
];

/** One transition in a job's lifecycle timeline. */
export interface JobStep {
  transition: JobTransition | "create";
  /** Job status AFTER this transition completed. */
  status: JobStatus;
  /** Counter-based tx hash from the local port. */
  txHash: string;
}

/** One job rendered by the /jobs lifecycle view. */
export interface JobRow {
  id: string;
  requester: string;
  worker: string;
  amount: Money;
  status: JobStatus;
  steps: JobStep[];
}

export interface JobLifecycleTotals {
  jobsTotal: number;
  settled: number;
  inFlight: number;
  totalEscrowed: Money;
}

export interface JobLifecycleContext {
  totals: JobLifecycleTotals;
  jobs: JobRow[];
}

/**
 * Drive each demo job through the REAL JobClient happy path —
 * create -> fund -> submit -> evaluate(passed) -> settle — over the local port,
 * capturing the tx hash of every step to build a status timeline. Deterministic.
 */
export async function getJobLifecycleContext(): Promise<JobLifecycleContext> {
  const port = new LocalErc8183Port();
  const jobs = configureErc8183({ port });
  const rows: JobRow[] = [];

  for (const seed of JOB_SEEDS) {
    const created = unwrap(
      "createJob",
      await jobs.createJob({
        requester: seed.requester,
        worker: seed.worker,
        amountUsdc: seed.amountUsdc,
        specUri: seed.specUri,
      }),
    );
    const jobId = created.jobId;
    const steps: JobStep[] = [{ transition: "create", status: "created", txHash: created.txHash }];

    const funded = unwrap(
      "fundEscrow",
      await jobs.fundEscrow({ jobId, amountUsdc: seed.amountUsdc }),
    );
    steps.push({ transition: "fund", status: "funded", txHash: funded.txHash });

    const submitted = unwrap(
      "submitDeliverable",
      await jobs.submitDeliverable({ jobId, deliverableUri: seed.deliverableUri }),
    );
    steps.push({ transition: "submit", status: "submitted", txHash: submitted.txHash });

    const evaluated = unwrap(
      "evaluate",
      await jobs.evaluate({ jobId, passed: true, scoreOrUri: "100" }),
    );
    steps.push({ transition: "evaluate_pass", status: "evaluated", txHash: evaluated.txHash });

    const settled = unwrap("settle", await jobs.settle({ jobId }));
    steps.push({ transition: "settle", status: "settled", txHash: settled.txHash });

    const final = unwrap<Job>("getJob", await jobs.getJob({ jobId }));
    rows.push({
      id: final.id,
      requester: final.requester,
      worker: final.worker,
      amount: final.amount,
      status: final.status,
      steps,
    });
  }

  const settledCount = rows.filter((r) => r.status === "settled").length;
  const totalEscrowed = sum(rows.map((r) => r.amount));
  return {
    totals: {
      jobsTotal: rows.length,
      settled: settledCount,
      inFlight: rows.length - settledCount,
      totalEscrowed,
    },
    jobs: rows,
  };
}
