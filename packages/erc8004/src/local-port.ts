/**
 * {@link LocalErc8004Port} — a deterministic, in-memory {@link Erc8004Port} for
 * tests, demos, and local development. It never touches a chain: it records
 * every call and returns synthetic, monotonically-numbered transaction hashes
 * so assertions are stable across runs. Mirrors app-kit's `LocalAppKitSdk`.
 *
 * Determinism: no `Date.now()` / `Math.random()`. Agent ids are sequential
 * decimal strings; tx hashes are counter-based; `requestHash` is an FNV-1a hash
 * of the subject padded to a bytes32-shaped hex.
 *
 * IMPORTANT: the FNV-1a `requestHash` is for stable in-memory lookup ONLY and
 * is NOT chain-compatible. A real on-chain port derives bytes32 via the
 * ValidationRegistry's actual hashing scheme (typically keccak256).
 */

import type { Erc8004Port } from "./port.js";
import type {
  FeedbackInput,
  TxResult,
  ValidationRequestInput,
  ValidationRequestResult,
  ValidationResponseInput,
  ValidationStatus,
} from "./types.js";
import { ARC_TESTNET_EXPLORER, explorerTxUrl } from "./addresses.js";

/**
 * Response value that marks a validation as passed. Per {@link ./types.js}
 * (`ValidationResponseInput`: "0–100; 100 = passed") we use a strict pass: a
 * response equal to {@link PASS_THRESHOLD}.
 */
const PASS_THRESHOLD = 100;

/** FNV-1a 32-bit offset basis. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
const FNV_PRIME = 0x01000193;

/**
 * Stable FNV-1a (32-bit) hash of `subject`, rendered as a 0x-prefixed,
 * 64-hex-char (bytes32-shaped) string. Deterministic and dependency-free.
 */
export function fnv1aHex(subject: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < subject.length; i += 1) {
    hash ^= subject.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  const word = hash.toString(16).padStart(8, "0");
  return `0x${word.padStart(64, "0")}`;
}

/** Options controlling the local port's simulated behavior. */
export interface LocalErc8004Options {
  /** The registering wallet that owns every agent minted by `register`. */
  owner: string;
}

export class LocalErc8004Port implements Erc8004Port {
  private readonly owner: string;
  private agentSeq = 0;
  private txCounter = 0;
  private readonly metadataByAgent = new Map<string, string>();
  private readonly ownerByAgent = new Map<string, string>();
  private readonly feedbackRecords: FeedbackInput[] = [];
  private readonly validations = new Map<string, ValidationStatus>();

  constructor(options: LocalErc8004Options) {
    this.owner = options.owner;
  }

  /** All recorded feedback, oldest first (for test assertions). */
  feedback(): readonly FeedbackInput[] {
    return [...this.feedbackRecords];
  }

  /** All registered agent ids, oldest first (for test assertions). */
  agents(): readonly string[] {
    return [...this.metadataByAgent.keys()];
  }

  /** Build a deterministic, counter-based transaction result. */
  private tx(): TxResult {
    this.txCounter += 1;
    const txHash = `0xlocal${this.txCounter.toString(16).padStart(8, "0")}`;
    return { txHash, explorerUrl: explorerTxUrl(txHash, ARC_TESTNET_EXPLORER) };
  }

  async register(input: { metadataUri: string }): Promise<TxResult> {
    this.agentSeq += 1;
    const agentId = String(this.agentSeq);
    this.metadataByAgent.set(agentId, input.metadataUri);
    this.ownerByAgent.set(agentId, this.owner);
    return this.tx();
  }

  async findAgentId(input: { owner: string }): Promise<string | null> {
    for (const [agentId, owner] of this.ownerByAgent) {
      if (owner === input.owner) return agentId;
    }
    return null;
  }

  async ownerOf(input: { agentId: string }): Promise<string> {
    const owner = this.ownerByAgent.get(input.agentId);
    if (owner === undefined) {
      throw new Error(`unknown agentId: ${input.agentId}`);
    }
    return owner;
  }

  async tokenUri(input: { agentId: string }): Promise<string> {
    const uri = this.metadataByAgent.get(input.agentId);
    if (uri === undefined) {
      throw new Error(`unknown agentId: ${input.agentId}`);
    }
    return uri;
  }

  async giveFeedback(input: FeedbackInput): Promise<TxResult> {
    this.feedbackRecords.push({ ...input });
    return this.tx();
  }

  async requestValidation(input: ValidationRequestInput): Promise<ValidationRequestResult> {
    const requestHash = fnv1aHex(input.subject);
    const status: ValidationStatus = {
      validator: input.validator,
      agentId: input.agentId,
      response: 0,
      tag: "",
      passed: false,
    };
    this.validations.set(requestHash, status);
    return { ...this.tx(), requestHash };
  }

  async respondValidation(input: ValidationResponseInput): Promise<TxResult> {
    const existing = this.validations.get(input.requestHash);
    if (existing === undefined) {
      throw new Error(`unknown requestHash: ${input.requestHash}`);
    }
    const updated: ValidationStatus = {
      ...existing,
      response: input.response,
      tag: input.tag ?? existing.tag,
      passed: input.response === PASS_THRESHOLD,
    };
    this.validations.set(input.requestHash, updated);
    return this.tx();
  }

  async getValidationStatus(input: { requestHash: string }): Promise<ValidationStatus> {
    const status = this.validations.get(input.requestHash);
    if (status === undefined) {
      throw new Error(`unknown requestHash: ${input.requestHash}`);
    }
    return { ...status };
  }
}
