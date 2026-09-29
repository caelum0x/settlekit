/**
 * LI.FI (li.quest) REST client — the fallback route provider.
 *
 *   GET {base}/quote/toAmount  exact destination amount to the merchant's
 *                              payTo (toAmountMin must cover the amount owed)
 *   GET {base}/status?txHash=&fromChain=&toChain=
 *
 * LI.FI tracks transfers by the ORIGIN transaction, so status needs the
 * buyer's origin tx hash. It has no deposit-address mode and is not used
 * for HyperCore (see destination.ts). Checked against live responses
 * recorded on 2026-09-29 (test/fixtures/lifi). LIFI_API_KEY is optional
 * (`x-lifi-api-key`).
 */

import { toDestinationUnits } from "./destination.js";
import { EVM_NATIVE, SOLANA_NATIVE } from "./origins.js";
import { feeBpsOf } from "./policy.js";
import { asRecord, isRouteError, optNumber, optString, requestJson, RouteError, type FetchLike } from "./http.js";
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
  RouteStep,
} from "./types.js";

export const LIFI_API_URL = "https://li.quest/v1";
const PROVIDER = "LI.FI";
/** LI.FI "transaction not found (yet)" error code. */
const LIFI_NOT_FOUND = "1003";
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

export interface LifiOptions {
  fetch?: FetchLike;
  baseUrl?: string;
  apiKey?: string;
  /** LI.FI integrator id (required by the API for attribution/fees). */
  integrator?: string;
  timeoutMs?: number;
}

/** The /quote/toAmount query for `request` (null when LI.FI cannot deliver it). */
export function buildLifiQuoteQuery(request: RouteQuoteRequest, integrator: string): URLSearchParams | null {
  const lifi = request.destination.lifi;
  if (lifi === null) return null;
  const params = new URLSearchParams({
    fromChain: String(request.origin.chainId),
    toChain: String(lifi.chainId),
    fromToken: request.origin.token,
    toToken: lifi.token,
    fromAddress: request.user,
    toAddress: request.recipient,
    toAmount: toDestinationUnits(request.amountBase, request.destination.decimals).toString(),
    integrator,
  });
  if (request.slippageBps !== undefined) params.set("slippage", String(request.slippageBps / 10_000));
  if (request.appFee && request.appFee.bps > 0) params.set("fee", String(request.appFee.bps / 10_000));
  return params;
}

function pad32(hex: string): string {
  return hex.replace(/^0x/, "").toLowerCase().padStart(64, "0");
}

/** ERC-20 approve(spender, amount) calldata. */
export function encodeApprove(spender: string, amount: bigint): string {
  return `${ERC20_APPROVE_SELECTOR}${pad32(spender)}${pad32(amount.toString(16))}`;
}

function tokenAmount(token: unknown, amount: string | undefined, minimum: string | undefined, usd: string | undefined, what: string): RouteAmount {
  const record = asRecord(token, what, PROVIDER);
  const chainId = optNumber(record.chainId);
  const address = optString(record.address);
  const decimals = optNumber(record.decimals);
  if (chainId === undefined || address === undefined || decimals === undefined || amount === undefined) {
    throw new RouteError("provider_unavailable", `${PROVIDER} quote is missing ${what} fields`);
  }
  return { chainId, token: address, symbol: optString(record.symbol) ?? "?", decimals, amount, minimumAmount: minimum ?? amount, amountUsd: usd ?? null };
}

function sumUsd(entries: unknown, onlyIncluded: boolean): string | null {
  if (!Array.isArray(entries)) return null;
  let total = 0;
  let seen = false;
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (onlyIncluded && record.included === false) continue;
    const usd = optNumber(record.amountUSD);
    if (usd === undefined) continue;
    total += usd;
    seen = true;
  }
  return seen ? total.toFixed(6) : null;
}

function hexToDecimal(value: unknown): string | undefined {
  const text = optString(value);
  if (text === undefined) return undefined;
  try {
    return BigInt(text).toString();
  } catch {
    return undefined;
  }
}

function isNative(token: string): boolean {
  return token.toLowerCase() === EVM_NATIVE || token === SOLANA_NATIVE;
}

function mainTx(record: Record<string, unknown>): EvmTxRequest | OpaqueTxRequest {
  const tx = record.transactionRequest;
  if (tx === null || typeof tx !== "object") throw new RouteError("provider_unavailable", `${PROVIDER} quote has no transaction`);
  const request = tx as Record<string, unknown>;
  const to = optString(request.to);
  const from = optString(request.from);
  const chainId = optNumber(request.chainId);
  if (to?.startsWith("0x") && from?.startsWith("0x") && chainId !== undefined) {
    const gas = hexToDecimal(request.gasLimit);
    return { vm: "evm", chainId, from, to, data: optString(request.data) ?? "0x", value: hexToDecimal(request.value) ?? "0", ...(gas ? { gas } : {}) };
  }
  return { vm: "other", chainId: chainId ?? null, raw: tx };
}

/** Normalize a LI.FI /quote/toAmount response. */
export function parseLifiQuote(body: unknown): RouteQuote {
  const record = asRecord(body, "quote", PROVIDER);
  const action = asRecord(record.action, "quote action", PROVIDER);
  const estimate = asRecord(record.estimate, "quote estimate", PROVIDER);
  const origin = tokenAmount(action.fromToken, optString(estimate.fromAmount), undefined, optString(estimate.fromAmountUSD), "fromToken");
  const destination = tokenAmount(
    action.toToken,
    optString(estimate.toAmount),
    optString(estimate.toAmountMin),
    optString(estimate.toAmountUSD),
    "toToken",
  );
  const requestId = optString(record.id);
  if (requestId === undefined) throw new RouteError("provider_unavailable", `${PROVIDER} quote has no id`);
  const main = mainTx(record);
  const steps: RouteStep[] = [];
  const spender = optString(estimate.approvalAddress);
  if (main.vm === "evm" && !isNative(origin.token) && spender !== undefined) {
    steps.push({
      id: "approve",
      kind: "transaction",
      description: `Approve ${origin.symbol}`,
      items: [
        {
          status: "incomplete",
          tx: { vm: "evm", chainId: main.chainId, from: main.from, to: origin.token, data: encodeApprove(spender, BigInt(origin.amount)), value: "0" },
        },
      ],
    });
  }
  steps.push({ id: "deposit", kind: "transaction", description: `Send ${origin.symbol} through ${optString(record.tool) ?? "LI.FI"}`, items: [{ status: "incomplete", tx: main }] });
  const slippage = optNumber(action.slippage);
  const totalUsd =
    origin.amountUsd !== null && destination.amountUsd !== null
      ? Math.max(0, Number(origin.amountUsd) - Number(destination.amountUsd)).toFixed(6)
      : null;
  return {
    provider: "lifi",
    requestId,
    origin,
    destination,
    recipient: optString(action.toAddress) ?? "",
    fees: { totalUsd, relayerUsd: sumUsd(estimate.feeCosts, true), appUsd: null, gasUsd: sumUsd(estimate.gasCosts, false) },
    feeBps: feeBpsOf(origin.amountUsd, destination.amountUsd),
    slippageBps: slippage === undefined ? null : Math.round(slippage * 10_000),
    steps,
    timeEstimateSec: optNumber(estimate.executionDuration) ?? null,
  };
}

function txHashOf(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  const hash = optString((value as Record<string, unknown>).txHash);
  return hash ? [hash] : [];
}

/** Normalize a LI.FI /status response. */
export function parseLifiStatus(body: unknown, query: RouteStatusQuery): RouteStatus {
  const record = asRecord(body, "status", PROVIDER);
  const status = optString(record.status) ?? "NOT_FOUND";
  const substatus = optString(record.substatus);
  const receiving = txHashOf(record.receiving);
  const base: RouteStatus = {
    provider: "lifi",
    state: "unknown",
    originTxHashes: txHashOf(record.sending),
    destinationTxHashes: [],
    refundTxHashes: [],
    originChainId: query.originChainId,
    destinationChainId: query.destinationChainId,
    detail: optString(record.substatusMessage) ?? substatus ?? null,
    updatedAt: null,
  };
  switch (status) {
    case "NOT_FOUND":
      return { ...base, state: "waiting" };
    case "PENDING":
      return { ...base, state: "pending" };
    case "INVALID":
    case "FAILED":
      return { ...base, state: "failure" };
    case "DONE":
      if (substatus === "REFUNDED") return { ...base, state: "refund", refundTxHashes: receiving };
      // PARTIAL = the buyer got a different token: the merchant was not paid.
      if (substatus === "PARTIAL") return { ...base, state: "failure", detail: base.detail ?? "partial fill" };
      return { ...base, state: "success", destinationTxHashes: receiving };
    default:
      return base;
  }
}

/** LI.FI as a {@link RouteProvider}. */
export function createLifiProvider(options: LifiOptions = {}): RouteProvider {
  const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
  const baseUrl = (options.baseUrl ?? LIFI_API_URL).replace(/\/+$/, "");
  const headers: Record<string, string> = options.apiKey ? { "x-lifi-api-key": options.apiKey } : {};
  const integrator = options.integrator ?? "settlekit";
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    name: "lifi",
    supports(destination: RouteDestination, _origin: RouteOrigin, depositAddress: boolean): boolean {
      return destination.lifi !== null && !depositAddress;
    },
    async quote(request: RouteQuoteRequest): Promise<RouteQuote> {
      const query = buildLifiQuoteQuery(request, integrator);
      if (query === null || request.depositAddress) {
        throw new RouteError("unsupported", `${PROVIDER} cannot route to ${request.destination.network} in this mode`);
      }
      const body = await requestJson({ fetch: fetchImpl, url: `${baseUrl}/quote/toAmount?${query}`, method: "GET", headers, timeoutMs, provider: PROVIDER });
      return parseLifiQuote(body);
    },
    async status(query: RouteStatusQuery): Promise<RouteStatus> {
      if (query.originTxHash === undefined) {
        return parseLifiStatus({ status: "NOT_FOUND" }, query);
      }
      const params = new URLSearchParams({
        txHash: query.originTxHash,
        fromChain: String(query.originChainId),
        toChain: String(query.destinationChainId),
      });
      try {
        const body = await requestJson({ fetch: fetchImpl, url: `${baseUrl}/status?${params}`, method: "GET", headers, timeoutMs, provider: PROVIDER });
        return parseLifiStatus(body, query);
      } catch (error) {
        // The origin tx is not indexed yet: keep waiting rather than failing.
        if (isRouteError(error) && error.providerCode === LIFI_NOT_FOUND) return parseLifiStatus({ status: "NOT_FOUND" }, query);
        throw error;
      }
    },
  };
}
