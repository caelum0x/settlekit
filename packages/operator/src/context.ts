/**
 * Contracts between the operator service, its decision engines and the
 * read-side capabilities the engines (and Claude's tools) can use.
 */
import type { ComplianceSignal } from "@settlekit/compliance";
import type { RiskDecision } from "@settlekit/risk";
import type { Proposal } from "./actions.js";
import type { DecisionUsage, ToolCallRecord } from "./decision-log.js";
import type { OperatorEvent } from "./events.js";
import type { OperatorPolicy } from "./policy.js";
import type { OperatorStore } from "./store.js";
import type { VaultSnapshot } from "./types.js";

/** Where the active policy for an org comes from. */
export interface PolicySource {
  get(orgId: string): Promise<OperatorPolicy>;
}

/** Risk + compliance view of one counterparty address. */
export interface CounterpartyAssessment {
  readonly address: string;
  readonly risk: RiskDecision;
  readonly riskFlags: readonly string[];
  readonly complianceSignals: readonly ComplianceSignal[];
  readonly screening: "circle" | "unavailable" | "not_configured";
  readonly screeningResult?: "APPROVED" | "DENIED";
}

export interface CounterpartyScreener {
  assess(orgId: string, address: string, amount: bigint, now: Date): Promise<CounterpartyAssessment>;
}

/** One past money movement involving a counterparty. */
export interface PaymentHistoryEntry {
  readonly decisionId: string;
  readonly direction: "in" | "out";
  readonly counterparty: string;
  readonly amount: bigint;
  readonly kind: string;
  readonly at: string;
  readonly txHash?: string;
}

export interface PaymentHistory {
  list(orgId: string, counterparty?: string, limit?: number): Promise<readonly PaymentHistoryEntry[]>;
}

/** A priced x402 resource, read from its 402 challenge without paying. */
export interface X402Quote {
  readonly url: string;
  readonly price: bigint;
  readonly payTo: string;
  readonly network: string;
  readonly resource: string;
}

export interface X402Purchase {
  readonly quote: X402Quote;
  readonly txHash: string;
  readonly status: number;
  /** Response body (truncated), untrusted third-party content. */
  readonly body: string;
}

export interface X402Gateway {
  quote(url: string): Promise<X402Quote>;
  buy(url: string, maxPrice: bigint): Promise<X402Purchase>;
  purchasesToday(orgId: string, now: Date): Promise<number>;
}

/** Everything an engine may consult while deciding. */
export interface EngineContext {
  readonly orgId: string;
  readonly policy: OperatorPolicy;
  readonly vault: VaultSnapshot;
  readonly now: Date;
  readonly store: OperatorStore;
  readonly screener?: CounterpartyScreener;
  readonly history?: PaymentHistory;
  readonly x402?: X402Gateway;
  readonly x402PurchasesToday: number;
}

export interface EngineDecision {
  readonly model: string;
  readonly inputsDigest: string;
  readonly proposals: readonly Proposal[];
  readonly toolCalls: readonly ToolCallRecord[];
  readonly usage?: DecisionUsage;
}

export interface DecisionEngine {
  readonly name: string;
  decide(event: OperatorEvent, ctx: EngineContext): Promise<EngineDecision>;
}

/** Counterparty address involved in an event, if any. */
export function eventCounterparty(event: OperatorEvent): string | null {
  switch (event.type) {
    case "revenue.received":
      return event.payer;
    case "bill.due":
      return event.payee;
    case "refund.requested":
    case "dispute.opened":
      return event.customer;
    case "tick":
      return null;
  }
}

/** Risk inputs for the policy from an assessment (absent when not assessed). */
export function riskInputs(a: CounterpartyAssessment | null): {
  readonly risk?: RiskDecision;
  readonly complianceSignals?: readonly ComplianceSignal[];
} {
  return a ? { risk: a.risk, complianceSignals: a.complianceSignals } : {};
}
