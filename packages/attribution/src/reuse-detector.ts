/**
 * Reuse detection: did this generated text get grounded in a known source?
 *
 * Uses w-shingling (sliding windows of `k` words) and containment scoring: the
 * fraction of the *answer's* shingles that also appear in a candidate source.
 * Containment (answer ⊆ source) — rather than Jaccard — is the right shape here
 * because a short answer can be fully grounded in a long source without the two
 * shingle sets being similar in size. Cheap, deterministic, dependency-free; a
 * good first gate before charging a citation toll for implicit reuse.
 */

import { createHash } from "node:crypto";
import type { ReuseCandidate, ReuseMatch, ReuseOptions, ReuseReport } from "./types.js";

const DEFAULT_SHINGLE_SIZE = 4;
const DEFAULT_THRESHOLD = 0.18;
const DEFAULT_MIN_MATCHED = 2;

/** Lowercase, strip punctuation to spaces, collapse runs, and split to words. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * The set of `k`-word shingles in `text`. For text shorter than `k`, the whole
 * token run is one shingle, so short answers still produce a usable signal.
 */
export function shingleSet(text: string, k: number = DEFAULT_SHINGLE_SIZE): Set<string> {
  const tokens = tokenize(text);
  const set = new Set<string>();
  if (tokens.length === 0) {
    return set;
  }
  const size = Math.max(1, Math.min(k, tokens.length));
  for (let i = 0; i + size <= tokens.length; i++) {
    set.add(tokens.slice(i, i + size).join(" "));
  }
  return set;
}

/** Stable hash of the normalized token stream — an audit / dedupe key. */
export function textFingerprint(text: string): string {
  return createHash("sha256").update(tokenize(text).join(" ")).digest("hex");
}

/**
 * Score generated `text` against each candidate source and report which ones it
 * is grounded in. Matches are returned strongest-first.
 */
export function detectReuse(
  text: string,
  candidates: readonly ReuseCandidate[],
  options: ReuseOptions = {},
): ReuseReport {
  const k = options.shingleSize ?? DEFAULT_SHINGLE_SIZE;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minMatched = options.minMatched ?? DEFAULT_MIN_MATCHED;

  const answer = shingleSet(text, k);
  const total = answer.size;
  const textHash = textFingerprint(text);

  if (total === 0) {
    return { textHash, total: 0, matches: [], grounded: false };
  }

  const matches: ReuseMatch[] = [];
  for (const candidate of candidates) {
    const source = shingleSet(candidate.text, k);
    let matched = 0;
    for (const shingle of answer) {
      if (source.has(shingle)) {
        matched++;
      }
    }
    const score = matched / total;
    if (matched >= minMatched && score >= threshold) {
      matches.push({
        sourceId: candidate.id,
        ...(candidate.wallet !== undefined ? { wallet: candidate.wallet } : {}),
        score,
        matched,
        total,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score || b.matched - a.matched || a.sourceId.localeCompare(b.sourceId));

  return { textHash, total, matches, grounded: matches.length > 0 };
}
