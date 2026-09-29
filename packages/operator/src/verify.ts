/**
 * Independent verification of one decision:
 *   1. recompute the org's hash chain up to and including the record;
 *   2. for agent decisions, recompute the pre-execution commitment and check
 *      it equals `anchorHash` (owner actions on vault escalations re-anchor
 *      the original decision's hash, which must match that decision);
 *   3. for every transaction, fetch the Arc receipt (via `@settlekit/arc`)
 *      and require a `DecisionAnchored(anchorHash, action)` log from the vault.
 * A decision with transactions is never reported valid unless step 3 ran.
 */
import type { ArcTransactionReceipt, Hex } from "@settlekit/arc";
import { hexToString, keccak256, toBytes } from "viem";
import { commitmentHash, verifyChain, type ChainVerification, type DecisionRecord } from "./decision-log.js";
import { allDecisions } from "./proof.js";
import type { OperatorStore } from "./store.js";

export const DECISION_ANCHORED_TOPIC = keccak256(toBytes("DecisionAnchored(bytes32,bytes32)"));

export interface ReceiptSource {
  getTransactionReceipt(txHash: Hex): Promise<ArcTransactionReceipt | null>;
}

export interface OnChainCheck {
  readonly txHash: string;
  readonly status: "anchored" | "missing_anchor" | "not_found" | "reverted";
  readonly actions: readonly string[];
  readonly explorerUrl?: string;
}

export interface DecisionVerification {
  readonly decisionId: string;
  readonly orgId: string;
  readonly chain: ChainVerification;
  readonly hash: string;
  readonly anchorHash: string | null;
  readonly commitment: "match" | "mismatch" | "owner_reanchor" | "not_anchored";
  readonly onChain: readonly OnChainCheck[] | "not_configured";
  readonly valid: boolean;
}

export interface VerifyOptions {
  readonly receipts?: ReceiptSource;
  readonly vault?: string;
  readonly explorerUrl?: string;
}

function recordInput(record: DecisionRecord): Parameters<typeof commitmentHash>[0] {
  const { hash: _hash, seq: _seq, prevHash: _prev, ...input } = record;
  return input;
}

function actionName(topic: string | undefined): string {
  if (!topic) return "UNKNOWN";
  return hexToString(topic as Hex, { size: 32 }).replace(/\0+$/, "");
}

async function checkTx(txHash: string, anchor: string, options: VerifyOptions & { receipts: ReceiptSource }): Promise<OnChainCheck> {
  const explorer = options.explorerUrl ? { explorerUrl: `${options.explorerUrl.replace(/\/+$/, "")}/tx/${txHash}` } : {};
  const receipt = await options.receipts.getTransactionReceipt(txHash as Hex);
  if (!receipt) return { txHash, status: "not_found", actions: [], ...explorer };
  if (receipt.status !== "success") return { txHash, status: "reverted", actions: [], ...explorer };
  const vault = options.vault?.toLowerCase();
  const actions = receipt.logs
    .filter((l) => (!vault || l.address.toLowerCase() === vault) && l.topics[0] === DECISION_ANCHORED_TOPIC)
    .filter((l) => (l.topics[1] ?? "").toLowerCase() === anchor.toLowerCase())
    .map((l) => actionName(l.topics[2]));
  return { txHash, status: actions.length > 0 ? "anchored" : "missing_anchor", actions, ...explorer };
}

async function commitmentStatus(store: OperatorStore, record: DecisionRecord): Promise<DecisionVerification["commitment"]> {
  if (!record.anchorHash) return "not_anchored";
  if (commitmentHash(recordInput(record)) === record.anchorHash) return "match";
  const ref = record.eventRef.startsWith("escalation:") ? record.eventRef.slice("escalation:".length) : null;
  if (ref && (record.model === "owner" || record.model === "system")) {
    const escalation = await store.getEscalation(record.orgId, ref);
    const original = escalation ? await store.getDecision(record.orgId, escalation.decisionId) : null;
    if (original?.anchorHash === record.anchorHash) return "owner_reanchor";
  }
  return "mismatch";
}

/** Find a decision by id across orgs. */
export async function findDecision(store: OperatorStore, id: string): Promise<DecisionRecord | null> {
  for (const orgId of await store.listOrgIds()) {
    const found = await store.getDecision(orgId, id);
    if (found) return found;
  }
  return null;
}

export async function verifyDecision(store: OperatorStore, record: DecisionRecord, options: VerifyOptions = {}): Promise<DecisionVerification> {
  const prefix = (await allDecisions(store, record.orgId)).filter((r) => r.seq <= record.seq);
  const chain = verifyChain(prefix);
  const commitment = await commitmentStatus(store, record);
  const txs = record.txHashes ?? (record.txHash ? [record.txHash] : []);
  const receipts = options.receipts;
  const onChain = receipts && record.anchorHash
    ? await Promise.all(txs.map((tx) => checkTx(tx, record.anchorHash as string, { ...options, receipts })))
    : "not_configured";
  // A decision that moved money is only valid once its anchors were checked on Arc.
  const onChainOk = txs.length === 0 || (onChain !== "not_configured" && onChain.every((c) => c.status === "anchored"));
  return {
    decisionId: record.id,
    orgId: record.orgId,
    chain,
    hash: record.hash,
    anchorHash: record.anchorHash ?? null,
    commitment,
    onChain,
    valid: chain.valid && commitment !== "mismatch" && onChainOk,
  };
}
