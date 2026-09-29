/**
 * Relay (relay.link) REST client — hand-written, no SDK.
 *
 *   POST {base}/quote                 tradeType EXACT_OUTPUT: the merchant
 *                                     receives exactly the amount owed;
 *                                     recipient = session payTo, refundTo =
 *                                     buyer, optional appFees (bps),
 *                                     useDepositAddress + strict for the
 *                                     deposit-address (QR) mode
 *   GET  {base}/intents/status/v3?requestId=
 *
 * Request/response fields follow docs.relay.link (get-quote,
 * get-intents-status-v3, deposit-addresses) and were checked against live
 * responses recorded on 2026-09-29 (test/fixtures/relay). RELAY_API_KEY is
 * optional (higher rate limits) and sent as `x-api-key`.
 */

import { toDestinationUnits } from "./destination.js";
import { feeBpsOf } from "./policy.js";
import { asRecord, optNumber, optString, requestJson, RouteError, stringArray, type FetchLike } from "./http.js";
import type {
  EvmTxRequest,
  OpaqueTxRequest,
  RouteAmount,
  RouteDestination,
  RouteOrigin,
  RouteProvider,
  RouteQuote,
  RouteQuoteRequest,
  RouteStatus,
  RouteStatusQuery,
  RouteStatusState,
  RouteStep,
} from "./types.js";

export const RELAY_API_URL = "https://api.relay.link";
const PROVIDER = "Relay";

export interface RelayOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  apiKey?: string;
  /** Sent as `referrer` for attribution (Relay only accepts it with an API key). */
  referrer?: string;
  timeoutMs?: number;
}

/** The Relay /quote request body for `request`. */
export function buildRelayQuoteBody(request: RouteQuoteRequest, referrer?: string): Record<string, unknown> {
  const amount = toDestinationUnits(request.amountBase, request.destination.decimals);
  return {
    user: request.user,
    recipient: request.recipient,
    originChainId: request.origin.chainId,
    destinationChainId: request.destination.chainId,
    originCurrency: request.origin.token,
    destinationCurrency: request.destination.token,
    amount: amount.toString(),
    tradeType: "EXACT_OUTPUT",
    refundTo: request.refundTo,
    ...(request.depositAddress ? { useDepositAddress: true, strict: true } : {}),
    ...(request.appFee && request.appFee.bps > 0
      ? { appFees: [{ recipient: request.appFee.recipient, fee: String(request.appFee.bps) }] }
      : {}),
    ...(request.slippageBps !== undefined ? { slippageTolerance: String(request.slippageBps) } : {}),
    ...(referrer ? { referrer } : {}),
  };
}

function amountOf(value: unknown, what: string): RouteAmount {
  const record = asRecord(value, what, PROVIDER);
  const currency = asRecord(record.currency, `${what}.currency`, PROVIDER);
  const chainId = optNumber(currency.chainId);
  const token = optString(currency.address);
  const amount = optString(record.amount);
  const decimals = optNumber(currency.decimals);
  if (chainId === undefined || token === undefined || amount === undefined || decimals === undefined) {
    throw new RouteError("provider_unavailable", `${PROVIDER} quote is missing ${what} fields`);
  }
  return {
    chainId,
    token,
    symbol: optString(currency.symbol) ?? "?",
    decimals,
    amount,
    minimumAmount: optString(record.minimumAmount) ?? amount,
    amountUsd: optString(record.amountUsd) ?? null,
  };
}

function usdOf(fees: Record<string, unknown> | undefined, key: string): string | null {
  const entry = fees?.[key];
  if (entry === null || typeof entry !== "object") return null;
  return optString((entry as Record<string, unknown>).amountUsd) ?? null;
}

function txOf(data: unknown): EvmTxRequest | OpaqueTxRequest {
  if (data !== null && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const to = optString(record.to);
    const from = optString(record.from);
    const chainId = optNumber(record.chainId);
    if (to?.startsWith("0x") && from?.startsWith("0x") && chainId !== undefined) {
      const gas = optString(record.gas);
      const maxFee = optString(record.maxFeePerGas);
      const maxPriority = optString(record.maxPriorityFeePerGas);
      return {
        vm: "evm",
        chainId,
        from,
        to,
        data: optString(record.data) ?? "0x",
        value: optString(record.value) ?? "0",
        ...(gas ? { gas } : {}),
        ...(maxFee ? { maxFeePerGas: maxFee } : {}),
        ...(maxPriority ? { maxPriorityFeePerGas: maxPriority } : {}),
      };
    }
    return { vm: "other", chainId: chainId ?? null, raw: data };
  }
  return { vm: "other", chainId: null, raw: data };
}

function stepsOf(value: unknown): { steps: RouteStep[]; depositAddress?: string } {
  if (!Array.isArray(value) || value.length === 0) throw new RouteError("provider_unavailable", `${PROVIDER} quote has no steps`);
  let depositAddress: string | undefined;
  const steps = value.map((raw, index) => {
    const step = asRecord(raw, "step", PROVIDER);
    depositAddress = depositAddress ?? optString(step.depositAddress);
    const items = Array.isArray(step.items) ? step.items : [];
    return {
      id: optString(step.id) ?? `step-${index}`,
      kind: step.kind === "signature" ? "signature" : "transaction",
      description: optString(step.description) ?? optString(step.action) ?? "",
      items: items.map((item) => {
        const record = asRecord(item, "step item", PROVIDER);
        return { status: record.status === "complete" ? "complete" : "incomplete", tx: txOf(record.data) };
      }),
    } satisfies RouteStep;
  });
  return { steps, ...(depositAddress !== undefined ? { depositAddress } : {}) };
}

/** Normalize a Relay /quote response. */
export function parseRelayQuote(body: unknown): RouteQuote {
  const record = asRecord(body, "quote", PROVIDER);
  const details = asRecord(record.details, "quote details", PROVIDER);
  const fees = record.fees !== null && typeof record.fees === "object" ? (record.fees as Record<string, unknown>) : undefined;
  const origin = amountOf(details.currencyIn, "currencyIn");
  const destination = amountOf(details.currencyOut, "currencyOut");
  const { steps, depositAddress } = stepsOf(record.steps);
  const requestId = optString(record.requestId) ?? optString((record.steps as Array<Record<string, unknown>>)[0]?.requestId);
  if (requestId === undefined) throw new RouteError("provider_unavailable", `${PROVIDER} quote has no requestId`);
  const slippage = details.slippageTolerance;
  const slippageBps =
    slippage !== null && typeof slippage === "object" ? optNumber((slippage as Record<string, unknown>).total) ?? null : null;
  const feeBps = feeBpsOf(origin.amountUsd, destination.amountUsd);
  const totalUsd =
    origin.amountUsd !== null && destination.amountUsd !== null
      ? Math.max(0, Number(origin.amountUsd) - Number(destination.amountUsd)).toFixed(6)
      : null;
  return {
    provider: "relay",
    requestId,
    origin,
    destination,
    recipient: optString(details.recipient) ?? "",
    fees: { totalUsd, relayerUsd: usdOf(fees, "relayer"), appUsd: usdOf(fees, "app"), gasUsd: usdOf(fees, "gas") },
    feeBps,
    slippageBps,
    steps,
    ...(depositAddress !== undefined ? { depositAddress } : {}),
    timeEstimateSec: optNumber(details.timeEstimate) ?? null,
  };
}

const RELAY_STATES: Readonly<Record<string, RouteStatusState>> = {
  waiting: "waiting",
  depositing: "pending",
  pending: "pending",
  submitted: "pending",
  delayed: "pending",
  success: "success",
  refund: "refund",
  refunded: "refund",
  failure: "failure",
  unknown: "unknown",
};

/** Normalize a Relay /intents/status/v3 response. */
export function parseRelayStatus(body: unknown): RouteStatus {
  const record = asRecord(body, "status", PROVIDER);
  const raw = optString(record.status) ?? "unknown";
  const state = RELAY_STATES[raw] ?? "unknown";
  const outgoing = stringArray(record.txHashes);
  const failReason = optString(record.failReason);
  const detail = [optString(record.details), failReason && failReason !== "N/A" ? failReason : undefined].filter(Boolean).join(": ");
  return {
    provider: "relay",
    state,
    originTxHashes: stringArray(record.inTxHashes),
    // On success `txHashes` are destination fills; on refund they are the refund legs.
    destinationTxHashes: state === "success" ? outgoing : [],
    refundTxHashes: state === "refund" ? outgoing : [],
    originChainId: optNumber(record.originChainId) ?? null,
    destinationChainId: optNumber(record.destinationChainId) ?? null,
    detail: detail.length > 0 ? detail : null,
    updatedAt: optNumber(record.updatedAt) ?? optNumber(record.time) ?? null,
  };
}

/** Relay as a {@link RouteProvider}. */
export function createRelayProvider(options: RelayOptions = {}): RouteProvider {
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
  const baseUrl = (options.baseUrl ?? RELAY_API_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = options.apiKey ? { "x-api-key": options.apiKey } : {};
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    name: "relay",
    supports(_destination: RouteDestination, _origin: RouteOrigin, _depositAddress: boolean): boolean {
      // Relay serves every SettleKit destination (incl. Solana, HyperCore 1337,
      // Tempo 4217, Robinhood 4663) and both execution modes.
      return true;
    },
    async quote(request: RouteQuoteRequest): Promise<RouteQuote> {
      const body = await requestJson({
        fetch: fetchImpl,
        url: `${baseUrl}/quote`,
        method: "POST",
        headers,
        body: buildRelayQuoteBody(request, options.apiKey ? options.referrer : undefined),
        timeoutMs,
        provider: PROVIDER,
      });
      return parseRelayQuote(body);
    },
    async status(query: RouteStatusQuery): Promise<RouteStatus> {
      const body = await requestJson({
        fetch: fetchImpl,
        url: `${baseUrl}/intents/status/v3?requestId=${encodeURIComponent(query.requestId)}`,
        method: "GET",
        headers,
        timeoutMs,
        provider: PROVIDER,
      });
      return parseRelayStatus(body);
    },
  };
}
