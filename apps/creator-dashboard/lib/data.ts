/**
 * The creator dashboard's data layer.
 *
 * This is NOT mocked JSON — it drives the real settlement domain logic so the
 * UI shows exactly what the spine produces:
 *
 *  - sources are built with @settlekit/citation-toll `createSource` (with real
 *    citation edges between works);
 *  - every simulated paid access runs through `computeRoyaltyDistribution`, the
 *    same recursive split the toll handler uses, so a creator earns both from
 *    their own work and from the recursive share of everything that cites it;
 *  - the attribution panel runs @settlekit/attribution `detectReuse` over the
 *    sources and issues a real signed proof-of-citation.
 *
 * A fixed clock + fixed access counts make the dataset deterministic across
 * renders. Swap this module for the Pg-backed stores to go live.
 */

import {
  type Money,
  addMoney,
  isOk,
  money,
} from "@settlekit/common";
import {
  InMemorySourceRegistry,
  type Citation,
  type CreateSourceInput,
  type PersistedRoyaltyLeg,
  type RoyaltyLeg,
  type Source,
  computeRoyaltyDistribution,
  createSource,
} from "@settlekit/citation-toll";
import {
  detectReuse,
  issueCitationProof,
  verifyCitationProof,
  type CitationProof,
  type ReuseMatch,
} from "@settlekit/attribution";

/* -------------------------------------------------------------------------- */
/* Seed: creators + their citeable works                                      */
/* -------------------------------------------------------------------------- */

export interface Creator {
  wallet: string;
  name: string;
  handle: string;
}

const CREATORS: Record<string, Creator> = {
  ada: { wallet: "0xada0000000000000000000000000000000000001", name: "Ada Okafor", handle: "@ada" },
  bo: { wallet: "0xb00000000000000000000000000000000000000b", name: "Bo Tan", handle: "@bo" },
  cyd: { wallet: "0xcyd000000000000000000000000000000000000c", name: "Cyd Marín", handle: "@cyd" },
};

/** The signed-in creator whose statement this dashboard shows. */
export const ME = CREATORS.ada;

interface SourceSeed {
  slug: string;
  title: string;
  author: Creator;
  priceUsdc: string;
  summary: string;
  body: string;
  /** Slugs of works this one is grounded in, with their revenue share (bps). */
  cites?: { slug: string; shareBps: number }[];
  /** Deterministic number of paid accesses to simulate. */
  accesses: number;
}

const SEEDS: SourceSeed[] = [
  {
    slug: "primer",
    title: "The Recursive Settlement Primer",
    author: CREATORS.ada,
    priceUsdc: "0.0009",
    summary: "Why royalties should follow a work through every hand that cites it.",
    body:
      "Royalties should follow a work through every hand that made it. When settlement is sub-cent " +
      "and gas-free, a citation can pay its source automatically, and that payment can fan out " +
      "recursively to everything the source itself was grounded in.",
    accesses: 1200,
  },
  {
    slug: "proof",
    title: "Proof-of-Citation, Explained",
    author: CREATORS.ada,
    priceUsdc: "0.0006",
    summary: "A signed, expiring token an agent presents to prove it cited and paid for a source.",
    body:
      "A proof-of-citation is an HMAC-signed claim that an agent cited a set of sources under a paid " +
      "access. It is expiring and replay-protected, so a seller can trust it without re-querying the chain.",
    accesses: 300,
  },
  {
    slug: "practice",
    title: "Nanopayments in Practice",
    author: CREATORS.bo,
    priceUsdc: "0.0008",
    summary: "Wiring per-citation tolls into a real agent pipeline.",
    body:
      "In practice an agent pays a fraction of a cent per citation, the toll is batched into one " +
      "on-chain settlement, and the recursive split routes a share back to the primer it was grounded in.",
    cites: [{ slug: "primer", shareBps: 3500 }],
    accesses: 800,
  },
  {
    slug: "agent-tolls",
    title: "Agent Citation Tolls at the Boundary",
    author: CREATORS.cyd,
    priceUsdc: "0.0007",
    summary: "Charging implicit reuse, not just deliberate fetches.",
    body:
      "Reuse detection closes the loop: given the text an agent produced, detect which sources it was " +
      "grounded in and charge the toll, then settle recursively through the citation lineage.",
    cites: [{ slug: "practice", shareBps: 3000 }],
    accesses: 640,
  },
];

/* -------------------------------------------------------------------------- */
/* Build the source graph + simulate paid accesses                            */
/* -------------------------------------------------------------------------- */

const CLOCK = new Date("2026-06-18T09:00:00.000Z");

function buildRegistry(): { registry: InMemorySourceRegistry; bySlug: Map<string, Source> } {
  const registry = new InMemorySourceRegistry();
  const bySlug = new Map<string, Source>();

  // Two passes: originals first so derived works can cite their ids.
  const ordered = [...SEEDS].sort((a, b) => (a.cites ? 1 : 0) - (b.cites ? 1 : 0));
  for (const seed of ordered) {
    const cites: Citation[] = (seed.cites ?? []).map((c) => {
      const parent = bySlug.get(c.slug);
      if (parent === undefined) throw new Error(`seed ${seed.slug} cites unknown ${c.slug}`);
      return { sourceId: parent.id, shareBps: c.shareBps };
    });
    const created = createSourceOrThrow({
      organizationId: "org_creator_demo",
      title: seed.title,
      authorWallet: seed.author.wallet,
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

function createSourceOrThrow(input: CreateSourceInput): Source {
  const r = createSource(input, CLOCK);
  if (!isOk(r)) throw new Error("createSource failed in seed");
  return r.value;
}

export interface RoyaltyEvent extends RoyaltyLeg {
  accessId: string;
  /** The accessed source whose access generated this leg. */
  accessedSourceId: string;
  status: PersistedRoyaltyLeg["status"];
  settlementId?: string;
  createdAt: string;
}

function simulateLedger(): { registry: InMemorySourceRegistry; bySlug: Map<string, Source>; events: RoyaltyEvent[] } {
  const { registry, bySlug } = buildRegistry();
  const events: RoyaltyEvent[] = [];
  let seq = 0;

  for (const seed of SEEDS) {
    const source = bySlug.get(seed.slug);
    if (source === undefined) continue;
    const distribution = computeRoyaltyDistribution(registry, source.id);
    if (distribution === undefined) continue;

    for (let access = 0; access < seed.accesses; access++) {
      const accessId = `acc_${seed.slug}_${access}`;
      for (const leg of distribution.legs) {
        seq++;
        // Deterministically settle ~70% of legs; the rest stay pending.
        const settled = seq % 10 < 7;
        events.push({
          ...leg,
          accessId,
          accessedSourceId: source.id,
          status: settled ? "settled" : "pending",
          ...(settled ? { settlementId: `set_${(seq % 6) + 1}` } : {}),
          createdAt: new Date(CLOCK.getTime() + seq * 1000).toISOString(),
        });
      }
    }
  }
  return { registry, bySlug, events };
}

/* -------------------------------------------------------------------------- */
/* Aggregations for the UI                                                     */
/* -------------------------------------------------------------------------- */

function sum(amounts: Money[]): Money {
  return amounts.reduce<Money>((acc, m) => addMoney(acc, m), money("0"));
}

export interface SourceStat {
  id: string;
  /** Stable seed slug used for deep links (Source.id is random per render). */
  slug: string;
  title: string;
  priceUsdc: string;
  isMine: boolean;
  accesses: number;
  /** What the signed-in creator earned attributable to this source's accesses. */
  earnedByMe: Money;
  /** Whether this source cites another (it routes a share onward). */
  citesCount: number;
}

export interface StatementLine {
  accessId: string;
  sourceTitle: string;
  amount: Money;
  depth: number;
  status: PersistedRoyaltyLeg["status"];
  createdAt: string;
}

export interface PayoutSweep {
  settlementId: string;
  legs: number;
  amount: Money;
}

export interface AttributionExample {
  answer: string;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
  proof: CitationProof;
}

export interface CreatorContext {
  me: Creator;
  totals: {
    lifetime: Money;
    settled: Money;
    pending: Money;
    payingAccesses: number;
    sourcesAuthored: number;
  };
  statement: StatementLine[];
  sources: SourceStat[];
  payouts: PayoutSweep[];
  attribution: AttributionExample;
}

export function getCreatorContext(): CreatorContext {
  const { registry, bySlug, events } = simulateLedger();
  const titleById = new Map<string, Source>();
  for (const s of registry.all()) titleById.set(s.id, s);

  const mine = events.filter((e) => e.wallet.toLowerCase() === ME.wallet.toLowerCase());

  const settled = mine.filter((e) => e.status === "settled");
  const pending = mine.filter((e) => e.status === "pending");

  const statement: StatementLine[] = mine
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 40)
    .map((e) => ({
      accessId: e.accessId,
      sourceTitle: titleById.get(e.accessedSourceId)?.title ?? e.accessedSourceId,
      amount: e.amount,
      depth: e.depth,
      status: e.status,
      createdAt: e.createdAt,
    }));

  // Per-source: accesses + what I earned attributable to that accessed source.
  // Keyed on the stable seed slug — Source.id is random per render, so it must
  // never leak into URLs (see getSourceDetail / sources list links).
  const sources: SourceStat[] = SEEDS.map((seed) => {
    const s = bySlug.get(seed.slug);
    if (s === undefined) return undefined;
    const earnedByMe = sum(
      mine.filter((e) => e.accessedSourceId === s.id).map((e) => e.amount),
    );
    return {
      id: s.id,
      slug: seed.slug,
      title: s.title,
      priceUsdc: s.priceUsdc,
      isMine: s.authorWallet.toLowerCase() === ME.wallet.toLowerCase(),
      accesses: seed.accesses,
      earnedByMe,
      citesCount: s.cites.length,
    };
  }).filter((s): s is SourceStat => s !== undefined);

  // Payout sweeps: settled legs grouped by their settlement id.
  const bySweep = new Map<string, RoyaltyEvent[]>();
  for (const e of settled) {
    if (e.settlementId === undefined) continue;
    const arr = bySweep.get(e.settlementId) ?? [];
    arr.push(e);
    bySweep.set(e.settlementId, arr);
  }
  const payouts: PayoutSweep[] = [...bySweep.entries()]
    .map(([settlementId, legs]) => ({
      settlementId,
      legs: legs.length,
      amount: sum(legs.map((l) => l.amount)),
    }))
    .sort((a, b) => a.settlementId.localeCompare(b.settlementId));

  return {
    me: ME,
    totals: {
      lifetime: sum(mine.map((e) => e.amount)),
      settled: sum(settled.map((e) => e.amount)),
      pending: sum(pending.map((e) => e.amount)),
      payingAccesses: new Set(mine.map((e) => e.accessId)).size,
      sourcesAuthored: sources.filter((s) => s.isMine).length,
    },
    statement,
    sources,
    payouts,
    attribution: buildAttributionExample(registry),
  };
}

/* -------------------------------------------------------------------------- */
/* Deterministic, slug/settlementId-keyed detail lookups                       */
/* -------------------------------------------------------------------------- */

/** One royalty recipient in a source's recursive lineage. */
export interface LineageLeg {
  sourceId: string;
  wallet: string;
  amount: Money;
  depth: number;
}

/** A citation edge resolved to the cited work's title. */
export interface ResolvedCitation {
  sourceId: string;
  shareBps: number;
  title: string;
}

export interface SourceDetail {
  slug: string;
  source: Source;
  /** Works this source cites (routes a share onward to), titled. */
  cites: ResolvedCitation[];
  /** Deterministic number of simulated paid accesses for this source. */
  accesses: number;
  /** Per-access royalty lineage: own author (depth 0) + recursive cuts. */
  legs: LineageLeg[];
  /** Platform fee + distributable for one access, for context. */
  gross: Money;
  platformFee: Money;
  distributable: Money;
  /** What the signed-in creator earned attributable to this source's accesses. */
  earnedByMe: Money;
  /** Titles of works that cite this source (it earns a recursive cut of theirs). */
  citedByTitles: string[];
}

/** All stable seed slugs — for link building and generateStaticParams. */
export function listSourceSlugs(): string[] {
  return SEEDS.map((s) => s.slug);
}

/**
 * Resolve a per-source detail view by its stable seed slug. Returns undefined
 * for an unknown slug so callers can render a 404. Thin wrapper over the same
 * registry/distribution the dashboard already computes — no new domain logic.
 */
export function getSourceDetail(slug: string): SourceDetail | undefined {
  const { registry, bySlug, events } = simulateLedger();
  const source = bySlug.get(slug);
  if (source === undefined) return undefined;

  const titleById = new Map<string, string>();
  for (const s of registry.all()) titleById.set(s.id, s.title);

  const cites: ResolvedCitation[] = source.cites.map((c) => ({
    sourceId: c.sourceId,
    shareBps: c.shareBps,
    title: titleById.get(c.sourceId) ?? c.sourceId,
  }));

  const distribution = computeRoyaltyDistribution(registry, source.id);
  const legs: LineageLeg[] =
    distribution?.legs.map((leg) => ({
      sourceId: leg.sourceId,
      wallet: leg.wallet,
      amount: leg.amount,
      depth: leg.depth,
    })) ?? [];

  const mine = events.filter((e) => e.wallet.toLowerCase() === ME.wallet.toLowerCase());
  const earnedByMe = sum(
    mine.filter((e) => e.accessedSourceId === source.id).map((e) => e.amount),
  );

  const citedByTitles = registry
    .all()
    .filter((s) => s.cites.some((c) => c.sourceId === source.id))
    .map((s) => s.title);

  const accesses = SEEDS.find((seed) => seed.slug === slug)?.accesses ?? 0;

  return {
    slug,
    source,
    cites,
    accesses,
    legs,
    gross: distribution?.gross ?? money("0"),
    platformFee: distribution?.platformFee ?? money("0"),
    distributable: distribution?.distributable ?? money("0"),
    earnedByMe,
    citedByTitles,
  };
}

/** One settled royalty line within a payout sweep, titled for display. */
export interface PayoutLeg {
  accessId: string;
  sourceTitle: string;
  wallet: string;
  amount: Money;
  depth: number;
  status: PersistedRoyaltyLeg["status"];
  createdAt: string;
}

/** Aggregation of a sweep's lines by citation depth (tier). */
export interface PayoutDepthGroup {
  depth: number;
  lines: number;
  amount: Money;
}

export interface PayoutDetail {
  settlementId: string;
  legs: PayoutLeg[];
  total: Money;
  lineCount: number;
  byDepth: PayoutDepthGroup[];
}

/**
 * Resolve a payout (settlement sweep) detail view by its stable settlement id
 * (set_1..set_6). Returns undefined for an unknown/empty id so callers can 404.
 */
export function getPayoutDetail(settlementId: string): PayoutDetail | undefined {
  const { registry, events } = simulateLedger();
  const titleById = new Map<string, string>();
  for (const s of registry.all()) titleById.set(s.id, s.title);

  const mine = events.filter((e) => e.wallet.toLowerCase() === ME.wallet.toLowerCase());
  const rows = mine.filter(
    (e) => e.status === "settled" && e.settlementId === settlementId,
  );
  if (rows.length === 0) return undefined;

  const legs: PayoutLeg[] = rows
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((e) => ({
      accessId: e.accessId,
      sourceTitle: titleById.get(e.accessedSourceId) ?? e.accessedSourceId,
      wallet: e.wallet,
      amount: e.amount,
      depth: e.depth,
      status: e.status,
      createdAt: e.createdAt,
    }));

  const byDepthMap = new Map<number, RoyaltyEvent[]>();
  for (const e of rows) {
    const arr = byDepthMap.get(e.depth) ?? [];
    arr.push(e);
    byDepthMap.set(e.depth, arr);
  }
  const byDepth: PayoutDepthGroup[] = [...byDepthMap.entries()]
    .map(([depth, group]) => ({
      depth,
      lines: group.length,
      amount: sum(group.map((g) => g.amount)),
    }))
    .sort((a, b) => a.depth - b.depth);

  return {
    settlementId,
    legs,
    total: sum(rows.map((r) => r.amount)),
    lineCount: rows.length,
    byDepth,
  };
}

/* -------------------------------------------------------------------------- */
/* Attribution worked example (real detectReuse + signed proof)               */
/* -------------------------------------------------------------------------- */

const PROOF_SECRET = process.env.CITATION_PROOF_SECRET ?? "dev-citation-proof-secret";

/** Reuse detection report mapped to display titles + the citation toll quote. */
interface GroundingResult {
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
  /** The raw matched source ids, in detection order — feeds proof issuance. */
  sourceIds: string[];
}

/**
 * Shared core: run `detectReuse` over the demo corpus and resolve each match to
 * its source title, plus compute the citation toll quote as the sum of every
 * matched source's price. Used by the detect route, the worked example, and the
 * live proof flow so they cannot drift apart.
 */
function groundText(registry: InMemorySourceRegistry, text: string): GroundingResult {
  const candidates = registry.all().map((s) => ({
    id: s.id,
    text: [s.title, s.summary, s.body].join(". "),
    wallet: s.authorWallet,
  }));
  const report = detectReuse(text, candidates);
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
  return {
    grounded: report.grounded,
    matches,
    quoteUsdc: quote.amount,
    sourceIds: report.matches.map((m) => m.sourceId),
  };
}

/** Run reuse detection for arbitrary text against the demo source corpus. */
export function detectGroundingForText(text: string): {
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
} {
  const { registry } = buildRegistry();
  const { grounded, matches, quoteUsdc } = groundText(registry, text);
  return { grounded, matches, quoteUsdc };
}

/** A signed proof reduced to the public, serializable fields the UI renders. */
export interface SerializableProof {
  agent: string;
  accessId: string;
  sourceIds: string[];
  amountUsdc?: string;
  issuedAt: string;
  expiresAt?: string;
  signature: string;
}

/** The result of verifying a proof, reduced from a `Result` to plain fields. */
export interface ProofVerification {
  valid: boolean;
  claimAgent?: string;
  expiresAt?: string;
  error?: string;
}

export interface ProveGroundingResult {
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
  proof: SerializableProof;
  verification: ProofVerification;
}

/**
 * Detect grounding for arbitrary text, then issue a real signed
 * proof-of-citation for the matched sources and verify it with the same secret
 * and clock. The secret never leaves the server — only the proof's public
 * fields and the verification outcome are returned. Deterministic except for
 * the proof `nonce`/`signature`, which `issueCitationProof` randomizes per call.
 */
export function proveGroundingForText(text: string): ProveGroundingResult {
  const { registry } = buildRegistry();
  const { grounded, matches, quoteUsdc, sourceIds } = groundText(registry, text);

  const issued = issueCitationProof(
    {
      agent: "agent_research_demo",
      sourceIds,
      accessId: "acc_live_1",
      amountUsdc: quoteUsdc,
      ttlSeconds: 3600,
    },
    PROOF_SECRET,
    CLOCK,
  );

  const verified = verifyCitationProof(issued, PROOF_SECRET, CLOCK);
  const verification: ProofVerification = isOk(verified)
    ? {
        valid: true,
        claimAgent: verified.value.agent,
        ...(verified.value.expiresAt !== undefined ? { expiresAt: verified.value.expiresAt } : {}),
      }
    : { valid: false, error: verified.error.message };

  const proof: SerializableProof = {
    agent: issued.agent,
    accessId: issued.accessId,
    sourceIds: [...issued.sourceIds],
    ...(issued.amountUsdc !== undefined ? { amountUsdc: issued.amountUsdc } : {}),
    issuedAt: issued.issuedAt,
    ...(issued.expiresAt !== undefined ? { expiresAt: issued.expiresAt } : {}),
    signature: issued.signature,
  };

  return { grounded, matches, quoteUsdc, proof, verification };
}

function buildAttributionExample(registry: InMemorySourceRegistry): AttributionExample {
  const answer =
    "Royalties should follow a work through every hand that made it, and when settlement is " +
    "sub-cent and gas-free a citation can pay its source automatically.";

  const { matches, quoteUsdc, sourceIds } = groundText(registry, answer);

  const proof = issueCitationProof(
    {
      agent: "agent_research_demo",
      sourceIds,
      accessId: "acc_demo_1",
      amountUsdc: quoteUsdc,
      ttlSeconds: 3600,
    },
    PROOF_SECRET,
    CLOCK,
  );

  return { answer, matches, quoteUsdc, proof };
}
