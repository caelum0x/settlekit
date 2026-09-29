/**
 * Hash-chained decision log.
 *
 * Each record's `hash` is sha256 over the canonical JSON of every other field
 * (including `prevHash`), so editing, reordering, inserting or deleting any
 * record breaks the chain from that point on. Hashes are 0x-prefixed 32-byte
 * hex — the exact `bytes32 decisionHash` anchored by OperatorVault's
 * `DecisionAnchored` event.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "./json.js";
import type { PolicyVerdict } from "./policy.js";

export const GENESIS_HASH = `0x${"0".repeat(64)}`;

export type DecisionOutcome = "executed" | "escalated" | "denied" | "deferred" | "failed";

export interface ToolCallRecord {
  readonly name: string;
  readonly input: unknown;
  readonly output?: unknown;
}

/** Fields supplied by the caller; ids, hashes and chaining are derived. */
export interface DecisionInput {
  readonly id: string;
  readonly orgId: string;
  readonly eventRef: string;
  /** Model id, or "heuristic" for the deterministic engine. */
  readonly model: string;
  /** Digest of the inputs the decision was made on (see {@link digest}). */
  readonly inputsDigest: string;
  readonly toolCalls: readonly ToolCallRecord[];
  readonly policyVerdict: PolicyVerdict | null;
  readonly rationale: string;
  readonly alternatives: readonly string[];
  readonly confidence: number;
  readonly outcome: DecisionOutcome;
  readonly txHash?: string;
  /** Every vault transaction the decision produced (txHash is the first). */
  readonly txHashes?: readonly string[];
  /**
   * The bytes32 anchored on-chain in `DecisionAnchored`: {@link commitmentHash}
   * of the decision's reasoning, computed before execution.
   */
  readonly anchorHash?: string;
  /** Model token usage and USD cost, when an LLM made the decision. */
  readonly usage?: DecisionUsage;
  /** Wall-clock milliseconds from event receipt to recorded decision. */
  readonly latencyMs?: number;
  readonly createdAt: string;
}

export interface DecisionUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
}

/** Tool-trace entries appended after execution; excluded from the commitment. */
export const POST_EXECUTION_TRACES: ReadonlySet<string> = new Set(["execute", "owner_result"]);

/** Fields that are only known after execution; excluded from the commitment. */
const POST_EXECUTION_FIELDS = ["outcome", "txHash", "txHashes", "anchorHash", "latencyMs"] as const;

/**
 * Pre-execution commitment of a decision: sha256 over everything the agent
 * decided (event, model, inputs, tool trace, verdict, rationale, alternatives,
 * confidence) but not the execution results. This is what the vault anchors,
 * so the on-chain log proves the reasoning existed before the money moved.
 * It does not depend on chain position, so a record can be re-linked onto a
 * new head without invalidating its anchor.
 */
export function commitmentHash(input: DecisionInput): string {
  const excluded: ReadonlySet<string> = new Set(POST_EXECUTION_FIELDS);
  const body = Object.fromEntries(Object.entries(input).filter(([key]) => !excluded.has(key)));
  const toolCalls = input.toolCalls.filter((c) => !POST_EXECUTION_TRACES.has(c.name));
  return digest({ ...body, toolCalls });
}

export interface DecisionRecord extends DecisionInput {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export interface ChainVerification {
  readonly valid: boolean;
  readonly checked: number;
  /** Index of the first bad record, when invalid. */
  readonly brokenAt?: number;
  readonly reason?: string;
}

/** 0x-prefixed sha256 of the canonical JSON of `value`. */
export function digest(value: unknown): string {
  return `0x${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/** Hash of a record body (everything except `hash`). */
export function hashRecord(record: Omit<DecisionRecord, "hash">): string {
  return digest(record);
}

/** Build the next record chained onto `prev` (null for the first record). */
export function chainDecision(prev: DecisionRecord | null, input: DecisionInput): DecisionRecord {
  const body: Omit<DecisionRecord, "hash"> = {
    ...input,
    seq: prev ? prev.seq + 1 : 0,
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return Object.freeze({ ...body, hash: hashRecord(body) });
}

/** Recompute the chain and report the first broken link, if any. */
export function verifyChain(records: readonly DecisionRecord[]): ChainVerification {
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as DecisionRecord;
    if (record.seq !== i) return broken(i, `seq ${record.seq} != position ${i}`);
    if (record.prevHash !== expectedPrev) return broken(i, "prevHash does not link to previous record");
    const { hash, ...body } = record;
    if (hashRecord(body) !== hash) return broken(i, "hash does not match record contents");
    expectedPrev = hash;
  }
  return { valid: true, checked: records.length };
}

function broken(index: number, reason: string): ChainVerification {
  return { valid: false, checked: index, brokenAt: index, reason };
}

/** Immutable append-only log; `append` returns a new log. */
export class DecisionLog {
  readonly records: readonly DecisionRecord[];

  constructor(records: readonly DecisionRecord[] = []) {
    this.records = Object.freeze([...records]);
  }

  get head(): DecisionRecord | null {
    return this.records[this.records.length - 1] ?? null;
  }

  append(input: DecisionInput): DecisionLog {
    return new DecisionLog([...this.records, chainDecision(this.head, input)]);
  }

  verify(): ChainVerification {
    return verifyChain(this.records);
  }
}
