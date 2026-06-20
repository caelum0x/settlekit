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
import { detectReuse, issueCitationProof, type CitationProof, type ReuseMatch } from "@settlekit/attribution";

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
  const sources: SourceStat[] = registry.all().map((s) => {
    const accesses = SEEDS.find((seed) => bySlug.get(seed.slug)?.id === s.id)?.accesses ?? 0;
    const earnedByMe = sum(
      mine.filter((e) => e.accessedSourceId === s.id).map((e) => e.amount),
    );
    return {
      id: s.id,
      title: s.title,
      priceUsdc: s.priceUsdc,
      isMine: s.authorWallet.toLowerCase() === ME.wallet.toLowerCase(),
      accesses,
      earnedByMe,
      citesCount: s.cites.length,
    };
  });

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
/* Attribution worked example (real detectReuse + signed proof)               */
/* -------------------------------------------------------------------------- */

const PROOF_SECRET = process.env.CITATION_PROOF_SECRET ?? "dev-citation-proof-secret";

/** Run reuse detection for arbitrary text against the demo source corpus. */
export function detectGroundingForText(text: string): {
  grounded: boolean;
  matches: (ReuseMatch & { title: string })[];
  quoteUsdc: string;
} {
  const { registry } = buildRegistry();
  const candidates = registry.all().map((s) => ({
    id: s.id,
    text: [s.title, s.summary, s.body].join(". "),
    wallet: s.authorWallet,
  }));
  const report = detectReuse(text, candidates);
  const titleById = new Map(registry.all().map((s) => [s.id, s.title]));
  const matches = report.matches.map((m) => ({ ...m, title: titleById.get(m.sourceId) ?? m.sourceId }));
  const quote = sum(
    report.matches.map((m) => {
      const s = registry.get(m.sourceId);
      return s !== undefined ? money(s.priceUsdc) : money("0");
    }),
  );
  return { grounded: report.grounded, matches, quoteUsdc: quote.amount };
}

function buildAttributionExample(registry: InMemorySourceRegistry): AttributionExample {
  const answer =
    "Royalties should follow a work through every hand that made it, and when settlement is " +
    "sub-cent and gas-free a citation can pay its source automatically.";

  const candidates = registry.all().map((s) => ({
    id: s.id,
    text: [s.title, s.summary, s.body].join(". "),
    wallet: s.authorWallet,
  }));
  const report = detectReuse(answer, candidates);

  const titleById = new Map(registry.all().map((s) => [s.id, s.title]));
  const matches = report.matches.map((m) => ({ ...m, title: titleById.get(m.sourceId) ?? m.sourceId }));
  const quote = sum(
    report.matches.map((m) => {
      const s = registry.get(m.sourceId);
      return s !== undefined ? money(s.priceUsdc) : money("0");
    }),
  );

  const proof = issueCitationProof(
    {
      agent: "agent_research_demo",
      sourceIds: report.matches.map((m) => m.sourceId),
      accessId: "acc_demo_1",
      amountUsdc: quote.amount,
      ttlSeconds: 3600,
    },
    PROOF_SECRET,
    CLOCK,
  );

  return { answer, matches, quoteUsdc: quote.amount, proof };
}
