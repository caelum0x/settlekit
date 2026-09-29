/**
 * Compliance screening gate for money-movement flows.
 *
 * Wraps the `@settlekit/compliance` screening client with the fail-safe policy
 * the API needs: when no screening client is configured the gate is a
 * pass-through (logged), and a `block` verdict throws a typed error that the
 * route maps to an HTTP 403. Sanctioned addresses are chain-agnostic, so a
 * network without a direct Circle chain mapping (e.g. Arc) is screened against
 * a configurable default chain.
 */
import { randomUUID } from "node:crypto";
import { SettleKitError } from "@settlekit/common";
import {
  decideCompliance,
  screeningToSignals,
  type ComplianceDecision,
  type ScreeningClient,
} from "@settlekit/compliance";

/** Map a SettleKit settlement network to a Circle screening chain id. */
export function circleChainForNetwork(network: string, defaultChain: string): string {
  switch (network) {
    case "base":
      return "BASE";
    case "ethereum":
      return "ETH";
    default:
      // Arc (and anything else Circle does not list) screens against the
      // configured default chain — sanctions hits are address-, not chain-, scoped.
      return defaultChain;
  }
}

export interface ScreenGateDeps {
  screening: ScreeningClient | null;
  defaultChain: string;
  logger?: { warn(msg: string, meta?: unknown): void };
}

/**
 * Screen `address` (on `network`) and throw `compliance_blocked` when the
 * verdict is `block`. A `review` verdict is allowed but surfaced via the
 * returned decision so callers can record it. No-op (returns `"allow"`) when
 * screening is unconfigured.
 */
export async function screenAddressOrThrow(
  deps: ScreenGateDeps,
  params: { address: string; network: string; context: string },
): Promise<ComplianceDecision> {
  if (!deps.screening) {
    deps.logger?.warn("compliance screening unconfigured; skipping", {
      context: params.context,
    });
    return "allow";
  }

  const screening = await deps.screening.screenAddress({
    chain: circleChainForNetwork(params.network, deps.defaultChain),
    address: params.address,
    idempotencyKey: randomUUID(),
  });
  const decision = decideCompliance(screeningToSignals(screening));

  if (decision === "block") {
    throw new SettleKitError({
      code: "compliance_blocked",
      message: `address ${params.address} failed compliance screening`,
      httpStatus: 403,
      details: {
        context: params.context,
        result: screening.result,
        riskSignals: screening.riskSignals,
      },
    });
  }
  return decision;
}
