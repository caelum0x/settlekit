/**
 * Counterparty screening: `@settlekit/risk` rules over the counterparty's
 * payment history plus Circle Compliance Engine address screening
 * (`@settlekit/compliance`). A screening outage is never treated as clean:
 * it yields a medium `wallet_risk` signal, which the policy escalates.
 */
import { randomUUID } from "node:crypto";
import { money } from "@settlekit/common";
import { screeningToSignals, type ComplianceSignal, type ScreeningClient } from "@settlekit/compliance";
import { RuleEngine, type ActivityEvent, type RiskContext } from "@settlekit/risk";
import type { CounterpartyAssessment, CounterpartyScreener, PaymentHistory, PaymentHistoryEntry } from "./context.js";
import { formatUsdc } from "./usdc.js";

export interface CounterpartyScreenerOptions {
  /** Circle address screening; omitted when CIRCLE_API_KEY is not configured. */
  readonly screening?: ScreeningClient;
  /** Circle chain id used for screening (Arc testnet by default). */
  readonly chain?: string;
  readonly rules?: RuleEngine;
  readonly history?: PaymentHistory;
  readonly idempotencyKey?: () => string;
}

const UNAVAILABLE: ComplianceSignal = { type: "wallet_risk", severity: "medium" };

function toActivity(entries: readonly PaymentHistoryEntry[]): readonly ActivityEvent[] {
  return entries.map((e) => ({ at: Date.parse(e.at), amount: money(formatUsdc(e.amount)) }));
}

export function createCounterpartyScreener(options: CounterpartyScreenerOptions = {}): CounterpartyScreener {
  const rules = options.rules ?? new RuleEngine();
  const chain = options.chain ?? "ARC-TESTNET";
  const newKey = options.idempotencyKey ?? randomUUID;

  async function screen(address: string): Promise<Pick<CounterpartyAssessment, "complianceSignals" | "screening" | "screeningResult">> {
    if (!options.screening) return { complianceSignals: [], screening: "not_configured" };
    try {
      const result = await options.screening.screenAddress({ chain, address, idempotencyKey: newKey() });
      return { complianceSignals: screeningToSignals(result), screening: "circle", screeningResult: result.result };
    } catch {
      return { complianceSignals: [UNAVAILABLE], screening: "unavailable" };
    }
  }

  return {
    async assess(orgId, address, amount, now) {
      const past = options.history ? await options.history.list(orgId, address, 200) : [];
      const ctx: RiskContext = {
        organizationId: orgId,
        customerId: address.toLowerCase(),
        now: now.getTime(),
        amount: money(formatUsdc(amount > 0n ? amount : 0n)),
        recentPayments: toActivity(past.filter((e) => e.direction === "in")),
        recentRefunds: toActivity(past.filter((e) => e.direction === "out" && e.kind === "refund")),
        walletAddress: address,
      };
      const assessment = rules.assess(ctx);
      const compliance = await screen(address);
      return Object.freeze({
        address,
        risk: assessment.decision,
        riskFlags: [...assessment.profile.flags],
        ...compliance,
      });
    },
  };
}
