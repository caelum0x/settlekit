/**
 * Attribution at the agent boundary (RFB 6.01).
 *
 * The citation toll charges an agent that *fetches* a gated article. This closes
 * the loop for *implicit* reuse: given the text an agent actually produced, it
 * detects which ingested sources that text was grounded in (@settlekit/attribution
 * reuse detection), quotes the toll owed, and issues a signed proof-of-citation
 * the agent can present downstream. Verification consumes the proof's nonce, so
 * a proof cannot be replayed.
 */

import {
  type CitationProof,
  type ProofStore,
  type ReuseCandidate,
  type ReuseOptions,
  type ReuseReport,
  detectReuse,
  issueCitationProof,
  verifyCitationProof,
} from "@settlekit/attribution";
import { type Money, addMoney, money } from "@settlekit/common";
import type { SourceRegistry } from "@settlekit/citation-toll";

/** A grounding report plus the toll owed for the sources it matched. */
export interface GroundingQuote extends ReuseReport {
  /** Sum of the matched sources' per-access tolls. */
  quoteUsdc: string;
}

export interface IssueProofRequest {
  agent: string;
  accessId: string;
  sourceIds: readonly string[];
  amountUsdc?: string;
  ttlSeconds?: number;
}

export interface AttributionService {
  /** Detect which ingested sources the given text is grounded in. */
  detect(text: string, options?: ReuseOptions): GroundingQuote;
  /** Issue and record a signed proof-of-citation. */
  issueProof(request: IssueProofRequest): Promise<CitationProof>;
  /** Verify a presented proof and atomically consume its nonce (anti-replay). */
  verify(proof: CitationProof): Promise<{ valid: boolean; reason?: string }>;
}

/** Build reuse candidates from the registry's sources (title + summary + body). */
function candidatesFrom(registry: SourceRegistry): ReuseCandidate[] {
  return registry.all().map((s) => ({
    id: s.id,
    text: [s.title, s.summary, s.body].filter((t) => t.length > 0).join(". "),
    wallet: s.authorWallet,
  }));
}

export function createAttributionService(deps: {
  registry: SourceRegistry;
  proofStore: ProofStore;
  proofSecret: string;
  now?: () => Date;
}): AttributionService {
  const now = deps.now ?? (() => new Date());

  return {
    detect(text, options) {
      const report = detectReuse(text, candidatesFrom(deps.registry), options);
      const quote = report.matches.reduce<Money>((sum, m) => {
        const source = deps.registry.get(m.sourceId);
        return source !== undefined ? addMoney(sum, money(source.priceUsdc)) : sum;
      }, money("0"));
      return { ...report, quoteUsdc: quote.amount };
    },

    async issueProof(request) {
      const proof = issueCitationProof(
        {
          agent: request.agent,
          sourceIds: request.sourceIds,
          accessId: request.accessId,
          ...(request.amountUsdc !== undefined ? { amountUsdc: request.amountUsdc } : {}),
          ...(request.ttlSeconds !== undefined ? { ttlSeconds: request.ttlSeconds } : {}),
        },
        deps.proofSecret,
        now(),
      );
      await deps.proofStore.record(proof);
      return proof;
    },

    async verify(proof) {
      const result = verifyCitationProof(proof, deps.proofSecret, now());
      if (!result.ok) {
        return { valid: false, reason: result.error.message };
      }
      const fresh = await deps.proofStore.consume(proof.nonce);
      if (!fresh) {
        return { valid: false, reason: "citation proof already consumed" };
      }
      return { valid: true };
    },
  };
}
