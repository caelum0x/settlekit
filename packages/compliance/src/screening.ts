/**
 * Circle Compliance Engine — Transaction Screening client + verdict mapping.
 *
 * Screens a blockchain address for sanctions/risk before SettleKit moves funds
 * to/from it. The result is mapped into the package's {@link ComplianceSignal}
 * model so the existing {@link decideCompliance} merge point combines it with
 * other signals.
 *
 * POST /v1/w3s/compliance/screening/addresses  { chain, address, idempotencyKey }
 *   -> { data: { result: "APPROVED" | "DENIED", decision?, riskSignals? } }
 *
 * Source: https://developers.circle.com/wallets/compliance-engine/tx-screening
 */
import { SettleKitError } from "@settlekit/common";
import type { ComplianceHttp } from "./http.js";
import { createFetchComplianceHttp } from "./http.js";
import type { ComplianceSignal } from "./index.js";

/** Circle's summary screening verdict for an address. */
export type ScreeningResult = "APPROVED" | "DENIED";

/** Circle risk categories surfaced on a screening signal. */
export type RiskCategory =
  | "SANCTIONS"
  | "CSAM"
  | "ILLICIT_BEHAVIOR"
  | "TERRORIST_FINANCING"
  | "GAMBLING"
  | string;

/** One risk signal Circle attaches to a screened address. */
export interface ScreeningRiskSignal {
  source?: string;
  riskScore?: "LOW" | "MEDIUM" | "HIGH" | "SEVERE" | "BLOCKLIST" | string;
  riskCategories?: RiskCategory[];
  type?: string;
}

/** The screening result for an address, normalized from Circle's response. */
export interface AddressScreening {
  /** Circle's screening id, when present. */
  id?: string;
  address: string;
  chain: string;
  result: ScreeningResult;
  riskSignals: ScreeningRiskSignal[];
  /** The raw Circle response, retained for audit/debugging. */
  raw: unknown;
}

/** Input to {@link ScreeningClient.screenAddress}. */
export interface ScreenAddressInput {
  /** Circle chain identifier (e.g. "ETH", "ARB", "MATIC"). */
  chain: string;
  address: string;
  /** UUIDv4 idempotency key; the caller supplies one for exactly-once semantics. */
  idempotencyKey: string;
}

/** Circle compliance address-screening client. */
export interface ScreeningClient {
  screenAddress(input: ScreenAddressInput): Promise<AddressScreening>;
}

export interface ScreeningClientConfig {
  apiKey: string;
  baseUrl?: string;
  http?: ComplianceHttp;
  fetchImpl?: typeof fetch;
}

/** Default Circle API base URL. */
export const DEFAULT_CIRCLE_COMPLIANCE_BASE_URL = "https://api.circle.com";

const SCREEN_ADDRESS_PATH = "/v1/w3s/compliance/screening/addresses";

/** High-risk scores that, even without an explicit DENIED, should block. */
const HARD_RISK_SCORES = new Set(["SEVERE", "BLOCKLIST"]);

/** Construct a screening client over Circle's Compliance Engine. */
export function createScreeningClient(config: ScreeningClientConfig): ScreeningClient {
  const http =
    config.http ??
    createFetchComplianceHttp({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl ?? DEFAULT_CIRCLE_COMPLIANCE_BASE_URL,
      ...(config.fetchImpl ? { fetchImpl: config.fetchImpl } : {}),
    });

  return {
    async screenAddress(input: ScreenAddressInput): Promise<AddressScreening> {
      const res = await http.request({
        method: "POST",
        path: SCREEN_ADDRESS_PATH,
        body: { chain: input.chain, address: input.address, idempotencyKey: input.idempotencyKey },
      });
      if (res.status >= 400) {
        throw new SettleKitError({
          code: "integration_error",
          message: `Circle address screening failed (status ${res.status})`,
          httpStatus: 502,
          details: { status: res.status, body: res.body },
        });
      }
      return parseScreening(res.body, input);
    },
  };
}

/** Normalize Circle's `{ data: {...} }` screening response. */
export function parseScreening(body: unknown, input: ScreenAddressInput): AddressScreening {
  const data = (isRecord(body) && isRecord(body.data) ? body.data : body) as Record<string, unknown>;
  const result = data.result === "DENIED" ? "DENIED" : "APPROVED";
  const rawSignals = Array.isArray(data.riskSignals)
    ? data.riskSignals
    : Array.isArray((data.decision as Record<string, unknown> | undefined)?.reasons)
      ? ((data.decision as Record<string, unknown>).reasons as unknown[])
      : [];
  const riskSignals: ScreeningRiskSignal[] = rawSignals.filter(isRecord).map((s) => ({
    ...(typeof s.source === "string" ? { source: s.source } : {}),
    ...(typeof s.riskScore === "string" ? { riskScore: s.riskScore } : {}),
    ...(Array.isArray(s.riskCategories) ? { riskCategories: s.riskCategories as string[] } : {}),
    ...(typeof s.type === "string" ? { type: s.type } : {}),
  }));
  return {
    ...(typeof data.id === "string" ? { id: data.id } : {}),
    address: input.address,
    chain: input.chain,
    result,
    riskSignals,
    raw: body,
  };
}

/**
 * Map a screening result into the package's {@link ComplianceSignal} model.
 * A DENIED result, a SANCTIONS/CSAM/terrorist category, or a SEVERE/BLOCKLIST
 * score produces a high-severity signal (→ `block`); other risk signals map to
 * medium (→ `review`).
 */
export function screeningToSignals(screening: AddressScreening): ComplianceSignal[] {
  const signals: ComplianceSignal[] = [];
  if (screening.result === "DENIED") {
    signals.push({ type: "sanctions_match", severity: "high" });
  }
  for (const s of screening.riskSignals) {
    const categories = (s.riskCategories ?? []).map((c) => c.toUpperCase());
    const score = (s.riskScore ?? "").toUpperCase();
    if (
      categories.includes("SANCTIONS") ||
      categories.includes("CSAM") ||
      categories.includes("TERRORIST_FINANCING") ||
      HARD_RISK_SCORES.has(score)
    ) {
      signals.push({ type: "sanctions_match", severity: "high" });
    } else if (score === "HIGH") {
      signals.push({ type: "wallet_risk", severity: "high" });
    } else if (score === "MEDIUM" || categories.length > 0) {
      signals.push({ type: "wallet_risk", severity: "medium" });
    }
  }
  return signals;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
