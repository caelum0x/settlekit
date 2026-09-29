/**
 * "Pay with any token" (server side): the buyer pays from another chain or
 * token; a route provider (Relay, LI.FI fallback) delivers the session's
 * stablecoin to the merchant's payTo on the session's network.
 *
 *   1. `getAnyTokenOptions`  origins the policy allows + current route.
 *   2. `quoteRoute`          EXACT_OUTPUT quote to payTo (refundTo = buyer),
 *                            checked against the fee/slippage/origin policy,
 *                            stored as `session.route`.
 *   3. `getRouteStatusView`  polls the provider; once it reports a fill, the
 *                            DESTINATION transfer is verified by the network's
 *                            fail-closed verifier through `recordAndConfirm`.
 *                            Provider "success" without a verified Transfer to
 *                            payTo >= the amount owed after session creation
 *                            leaves the session unpaid.
 *
 * Env: ROUTING_ENABLED, RELAY_API_KEY, ROUTE_* (see @settlekit/routing env).
 * Mainnet only; Arc and Zcash are never routed.
 */
import { ChainConfigError, isValidEvmAddress, isValidSolanaAddress, isValidTxHash } from "@settlekit/chains";
import { toBaseUnits, type CheckoutRoute, type CheckoutSession } from "@settlekit/common";
import {
  applyRouteStatus,
  createRouterFromConfig,
  depositPaymentUri,
  findOrigin,
  formatBaseUnits,
  isRouteError,
  isRouteTerminal,
  loadRoutingConfig,
  ORIGIN_CHAINS,
  originExplorerTxUrl,
  checkOrigin,
  quoteExpiresAt,
  routeDestinationFor,
  routeFromQuote,
  type DestinationResult,
  type EvmTxRequest,
  type FetchLike,
  type RouteQuote,
  type RouteQuoteRequest,
  type Router,
  type RoutingConfig,
} from "@settlekit/routing";

import { CheckoutError, isCheckoutError } from "./errors";
import { enabledEvmChain } from "./evm";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import { explorerTxUrl } from "./format";
import { networkEnv, networkUnavailableReason } from "./network-options";
import { configuredSolanaCluster } from "./solana";
import { defaultStoreDeps, getConfirmedPayment, getResolvedSession, hasRecordedPayment, recordAndConfirm, type StoreDeps } from "./store";
import type { VerifyDeps } from "./verify-payment";
import { payToFor } from "./verify-payment";

type Env = Readonly<Record<string, string | undefined>>;

export interface RoutingRuntime {
  config: RoutingConfig;
  router: Router;
}

export type RoutingRuntimeResult = { ok: true; runtime: RoutingRuntime } | { ok: false; error: string };

const RELEVANT_KEYS = [
  "ROUTING_ENABLED",
  "RELAY_API_URL",
  "RELAY_API_KEY",
  "LIFI_ENABLED",
  "LIFI_API_URL",
  "LIFI_API_KEY",
  "LIFI_INTEGRATOR",
  "ROUTE_MAX_FEE_BPS",
  "ROUTE_MAX_SLIPPAGE_BPS",
  "ROUTE_QUOTE_TTL_SEC",
  "ROUTE_ORIGIN_ALLOWLIST",
  "ROUTE_APP_FEE_BPS",
  "ROUTE_APP_FEE_RECIPIENT",
];

/** Build the routing runtime from `env` (tests inject a recorded fetch). */
export function loadRoutingRuntime(env: Env, fetchImpl?: FetchLike): RoutingRuntimeResult {
  let config: RoutingConfig | null;
  try {
    config = loadRoutingConfig(env);
  } catch (error) {
    if (error instanceof ChainConfigError) return { ok: false, error: `Routing configuration error: ${error.message}` };
    throw error;
  }
  if (config === null) return { ok: false, error: "Paying with other tokens is not enabled on this checkout." };
  return { ok: true, runtime: { config, router: createRouterFromConfig(config, fetchImpl) } };
}

let cached: { key: string; result: RoutingRuntimeResult } | undefined;

export function getRoutingRuntime(env: Env = process.env): RoutingRuntimeResult {
  const key = JSON.stringify(RELEVANT_KEYS.map((name) => env[name] ?? null));
  if (cached?.key !== key) cached = { key, result: loadRoutingRuntime(env) };
  return cached.result;
}

/** Where a route for `session` must deliver (the token its verifier checks). */
export function destinationForSession(session: CheckoutSession, verify: VerifyDeps): DestinationResult {
  const network = session.network;
  const chain = enabledEvmChain(verify.evm, network);
  return routeDestinationFor(network, {
    env: networkEnv(network, verify),
    ...(chain !== undefined ? { tokenAddress: chain.tokenAddress } : {}),
  });
}

/** Whether any-token payment is offered for `session` right now (and why not). */
export function anyTokenAvailability(
  session: CheckoutSession,
  verify: VerifyDeps,
  routing: RoutingRuntimeResult,
): { available: boolean; reason?: string } {
  if (!routing.ok) return { available: false, reason: routing.error };
  const unavailable = networkUnavailableReason(session, session.network, verify);
  if (unavailable !== undefined) return { available: false, reason: unavailable };
  const destination = destinationForSession(session, verify);
  return destination.ok ? { available: true } : { available: false, reason: `Routing to this network is not possible: ${destination.reason}.` };
}

// --- views -------------------------------------------------------------------

export interface OriginChainOption {
  chainId: number;
  name: string;
  vm: "evm" | "svm";
  tokens: Array<{ symbol: string; address: string; decimals: number; native: boolean }>;
}

/** GET route/quote response. */
export interface AnyTokenOptionsResponse {
  available: boolean;
  reason?: string;
  destination: { network: string; symbol: string } | null;
  origins: OriginChainOption[];
  maxFeeBps: number | null;
  route: RouteStatusView | null;
}

export interface RouteAmountView {
  chainId: number;
  symbol: string;
  decimals: number;
  amount: string;
  formatted: string;
  amountUsd: string | null;
}

/** POST route/quote response. */
export interface RouteQuoteView {
  provider: "relay" | "lifi";
  requestId: string;
  origin: RouteAmountView;
  destination: RouteAmountView;
  fees: { totalUsd: string | null; relayerUsd: string | null; appUsd: string | null; gasUsd: string | null; feeBps: number | null };
  /** EVM transactions the buyer's wallet sends, in order (empty in deposit mode). */
  transactions: EvmTxRequest[];
  /** Whether every step can run in the buyer's browser wallet. */
  walletExecutable: boolean;
  depositAddress: string | null;
  /** QR payload for the deposit address (EIP-681 / Solana Pay). */
  depositUri: string | null;
  refundTo: string;
  expiresAt: string;
  timeEstimateSec: number | null;
}

export type RouteStatusState =
  | "quoted"
  | "waiting"
  | "pending"
  /** The provider reported a fill; the destination transfer is being verified. */
  | "confirming"
  | "paid"
  /** Provider says success, but no qualifying destination transfer verified: NOT paid. */
  | "unverified"
  | "refund"
  | "failure";

/** POST route/status response. */
export interface RouteStatusView {
  state: RouteStatusState;
  provider: "relay" | "lifi";
  message: string | null;
  originChainId: number;
  originTxHash: string | null;
  originExplorerUrl: string | null;
  destinationTxHash: string | null;
  destinationExplorerUrl: string | null;
  refundTxHash: string | null;
  refundExplorerUrl: string | null;
  refundTo: string;
  expiresAt: string;
}

function amountView(amount: RouteQuote["origin"]): RouteAmountView {
  return {
    chainId: amount.chainId,
    symbol: amount.symbol,
    decimals: amount.decimals,
    amount: amount.amount,
    formatted: formatBaseUnits(amount.amount, amount.decimals),
    amountUsd: amount.amountUsd,
  };
}

function destinationExplorer(session: CheckoutSession, hash: string, verify: VerifyDeps): string {
  return explorerTxUrl(session.network, hash, { chainEnv: networkEnv(session.network, verify), solanaCluster: configuredSolanaCluster() }) || "";
}

/** View state for a stored route (a provider "success" is only "confirming" until verified). */
function viewState(route: CheckoutRoute): RouteStatusState {
  return route.state === "success" ? "confirming" : route.state;
}

export function routeStatusView(
  session: CheckoutSession,
  route: CheckoutRoute,
  verify: VerifyDeps,
  state: RouteStatusState = viewState(route),
  message: string | null = route.detail ?? null,
): RouteStatusView {
  const link = (hash: string | undefined, url: (value: string) => string) => (hash ? url(hash) || null : null);
  return {
    state,
    provider: route.provider,
    message,
    originChainId: route.originChainId,
    originTxHash: route.originTxHash ?? null,
    originExplorerUrl: link(route.originTxHash, (hash) => originExplorerTxUrl(route.originChainId, hash)),
    destinationTxHash: route.destinationTxHash ?? null,
    destinationExplorerUrl: link(route.destinationTxHash, (hash) => destinationExplorer(session, hash, verify)),
    refundTxHash: route.refundTxHash ?? null,
    refundExplorerUrl: link(route.refundTxHash, (hash) => originExplorerTxUrl(route.originChainId, hash)),
    refundTo: route.originAddress,
    expiresAt: route.expiresAt,
  };
}

// --- flows -------------------------------------------------------------------

function requireRouting(routing: RoutingRuntimeResult): RoutingRuntime {
  if (!routing.ok) throw new CheckoutError("network_not_configured", routing.error);
  return routing.runtime;
}

async function payableSession(sessionId: string, deps: StoreDeps) {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  if (session.status === "completed") throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  if (session.status !== "open" || resolved.expired) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  return resolved;
}

/** Origins the buyer can pay from, plus the current route (GET route/quote). */
export async function getAnyTokenOptions(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
  routing: RoutingRuntimeResult = getRoutingRuntime(),
): Promise<AnyTokenOptionsResponse> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  const availability = anyTokenAvailability(session, deps.verify, routing);
  const destination = destinationForSession(session, deps.verify);
  const policy = routing.ok ? routing.runtime.config.policy : null;
  const origins: OriginChainOption[] =
    policy === null
      ? []
      : ORIGIN_CHAINS.map((chain) => ({
          chainId: chain.chainId,
          name: chain.name,
          vm: chain.vm,
          tokens: chain.tokens
            .filter((token) => checkOrigin(policy, { chainId: chain.chainId, token: token.address }).ok)
            .map((token) => ({ symbol: token.symbol, address: token.address, decimals: token.decimals, native: token.native })),
        })).filter((chain) => chain.tokens.length > 0);
  const route = session.route !== undefined && session.route.network === session.network ? routeStatusView(session, session.route, deps.verify) : null;
  return {
    available: availability.available,
    ...(availability.reason !== undefined ? { reason: availability.reason } : {}),
    destination: destination.ok ? { network: session.network, symbol: destination.destination.symbol } : null,
    origins: availability.available ? origins : [],
    maxFeeBps: policy?.maxFeeBps ?? null,
    route,
  };
}

export interface QuoteRouteInput {
  sessionId: string;
  originChainId: unknown;
  originToken: unknown;
  originAddress: unknown;
  depositAddress: unknown;
  fields: Record<string, unknown>;
}

function parseOrigin(input: QuoteRouteInput): { chainId: number; token: string; address: string; vm: "evm" | "svm"; deposit: boolean } {
  const chainId = typeof input.originChainId === "number" ? input.originChainId : Number.NaN;
  const token = typeof input.originToken === "string" ? input.originToken.trim() : "";
  const found = Number.isSafeInteger(chainId) ? findOrigin(chainId, token) : undefined;
  if (found === undefined) throw new CheckoutError("invalid_request", "Choose one of the offered origin chains and tokens.");
  const address = typeof input.originAddress === "string" ? input.originAddress.trim() : "";
  const validAddress = found.chain.vm === "evm" ? isValidEvmAddress(address) || /^0x[0-9a-f]{40}$/.test(address) : isValidSolanaAddress(address);
  if (!validAddress) {
    throw new CheckoutError("invalid_request", `Enter your ${found.chain.name} wallet address (refunds go there if the route fails).`);
  }
  // Solana origins pay through a deposit address (any Solana wallet can send to it).
  const deposit = found.chain.vm === "svm" ? true : input.depositAddress === true;
  return { chainId, token: found.token.address, address, vm: found.chain.vm, deposit };
}

/** Quote a route for the session (POST route/quote); stores `session.route`. */
export async function quoteRoute(
  input: QuoteRouteInput,
  deps: StoreDeps = defaultStoreDeps(),
  routing: RoutingRuntimeResult = getRoutingRuntime(),
  now: Date = new Date(),
): Promise<RouteQuoteView> {
  const { router, config } = requireRouting(routing);
  const resolved = await payableSession(input.sessionId, deps);
  const { session } = resolved;
  const availability = anyTokenAvailability(session, deps.verify, routing);
  if (!availability.available) throw new CheckoutError("network_not_configured", availability.reason ?? "Routing is unavailable.");
  if (await hasRecordedPayment(deps.backend, session.id)) {
    throw new CheckoutError("session_not_payable", "A payment is already recorded for this checkout.");
  }
  if (session.route !== undefined && session.route.network === session.network && !isRouteTerminal(session.route) && session.route.state !== "quoted") {
    throw new CheckoutError("session_not_payable", "A cross-chain payment for this checkout is already in progress.");
  }
  const origin = parseOrigin(input);
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const errors = validateFields(specs, input.fields);
  if (errors.length > 0) throw new CheckoutError("fields_incomplete", errors.join(" "));

  const destination = destinationForSession(session, deps.verify);
  if (!destination.ok) throw new CheckoutError("network_not_configured", destination.reason);
  const request: RouteQuoteRequest = {
    destination: destination.destination,
    amountBase: toBaseUnits(session.amount.amount),
    recipient: payToFor(session, session.network),
    origin: { chainId: origin.chainId, token: origin.token },
    user: origin.address,
    refundTo: origin.address,
    depositAddress: origin.deposit,
    ...(config.appFee !== null ? { appFee: config.appFee } : {}),
  };
  let quote: RouteQuote;
  try {
    quote = await router.quote(request);
  } catch (error) {
    if (!isRouteError(error)) throw error;
    const unavailable = error.code === "provider_unavailable" || error.code === "rate_limited";
    throw new CheckoutError(unavailable ? "provider_unavailable" : "route_rejected", `No route: ${error.message}`);
  }
  const expiresAt = quoteExpiresAt(config.policy, now);
  const route = routeFromQuote(quote, request, session.network, now, expiresAt);
  await deps.backend.checkouts.save({
    ...session,
    route,
    collectedFields: { ...session.collectedFields, ...sanitizeFields(specs, input.fields) },
  });

  const transactions = quote.steps.flatMap((step) =>
    step.items.filter((item) => item.status === "incomplete").map((item) => item.tx),
  );
  const evmTransactions = transactions.filter((tx): tx is EvmTxRequest => tx.vm === "evm");
  const walletExecutable =
    origin.vm === "evm" &&
    quote.steps.every((step) => step.kind === "transaction") &&
    evmTransactions.length === transactions.length &&
    evmTransactions.every((tx) => tx.chainId === origin.chainId);
  return {
    provider: quote.provider,
    requestId: quote.requestId,
    origin: amountView(quote.origin),
    destination: amountView(quote.destination),
    fees: { ...quote.fees, feeBps: quote.feeBps },
    transactions: walletExecutable ? evmTransactions : [],
    walletExecutable,
    depositAddress: quote.depositAddress ?? null,
    depositUri: quote.depositAddress ? depositPaymentUri(origin.chainId, origin.token, quote.depositAddress, quote.origin.amount) : null,
    refundTo: origin.address,
    expiresAt: expiresAt.toISOString(),
    timeEstimateSec: quote.timeEstimateSec,
  };
}

function parseOriginTxHash(route: CheckoutRoute, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") throw new CheckoutError("invalid_request", "originTxHash must be a string.");
  const hash = raw.trim();
  const vm = ORIGIN_CHAINS.find((chain) => chain.chainId === route.originChainId)?.vm;
  const ok = vm === "svm" ? isValidTxHash("solana", hash) : isValidTxHash("base", hash);
  if (!ok) throw new CheckoutError("invalid_request", "originTxHash is not a transaction hash for the origin chain.");
  return vm === "svm" ? hash : hash.toLowerCase();
}

/** Settle a provider-reported fill through the fail-closed verifier. */
async function settleFill(
  session: CheckoutSession,
  route: CheckoutRoute,
  deps: StoreDeps,
): Promise<RouteStatusView> {
  const hash = route.destinationTxHash as string;
  try {
    await recordAndConfirm(session.id, hash, deps);
    return routeStatusView(session, route, deps.verify, "paid", null);
  } catch (error) {
    if (!isCheckoutError(error)) throw error;
    if (error.code === "payment_pending") return routeStatusView(session, route, deps.verify, "confirming", error.message);
    if (error.code === "verification_failed" || error.code === "duplicate_tx" || error.code === "malformed_tx") {
      console.warn(`[checkout] route fill ${hash} for session ${session.id} did not verify: ${error.message}`);
      return routeStatusView(
        session,
        route,
        deps.verify,
        "unverified",
        `The provider reported a delivery, but no qualifying payment to the merchant was found on-chain (${error.message}). The order stays unpaid; contact the merchant with your transaction details.`,
      );
    }
    throw error;
  }
}

/** Poll the session's route and settle it once verified (POST route/status). */
export async function getRouteStatusView(
  input: { sessionId: string; originTxHash?: unknown },
  deps: StoreDeps = defaultStoreDeps(),
  routing: RoutingRuntimeResult = getRoutingRuntime(),
  now: Date = new Date(),
): Promise<RouteStatusView> {
  const session = await deps.backend.checkouts.findById(input.sessionId);
  if (!session) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const route = session.route;
  if (route === undefined || route.network !== session.network) {
    throw new CheckoutError("session_not_payable", "No cross-chain payment was started for this checkout.");
  }
  if (session.status === "completed") {
    const payment = await getConfirmedPayment(session.id, deps);
    const paidRoute = payment?.txHash ? { ...route, destinationTxHash: route.destinationTxHash ?? payment.txHash } : route;
    return routeStatusView(session, paidRoute, deps.verify, "paid", null);
  }
  const { router } = requireRouting(routing);
  const originTxHash = parseOriginTxHash(route, input.originTxHash);
  let current: CheckoutRoute = originTxHash !== undefined && route.originTxHash === undefined ? { ...route, originTxHash } : route;

  if (!isRouteTerminal(current)) {
    const destination = destinationForSession(session, deps.verify);
    if (!destination.ok) throw new CheckoutError("network_not_configured", destination.reason);
    try {
      const status = await router.status({
        provider: current.provider,
        requestId: current.requestId,
        originChainId: current.originChainId,
        destination: destination.destination,
        ...(current.originTxHash !== undefined ? { originTxHash: current.originTxHash } : {}),
      });
      current = applyRouteStatus(current, status, now);
    } catch (error) {
      if (!isRouteError(error)) throw error;
      if (current !== route) await deps.backend.checkouts.save({ ...session, route: current });
      throw new CheckoutError("provider_unavailable", `Could not reach ${current.provider === "relay" ? "Relay" : "LI.FI"}: ${error.message}`);
    }
  }
  const saved: CheckoutSession = current === route ? session : { ...session, route: current };
  if (saved !== session) await deps.backend.checkouts.save(saved);

  if (current.state === "success" && current.destinationTxHash !== undefined) return settleFill(saved, current, deps);
  if (current.state === "success") {
    return routeStatusView(saved, current, deps.verify, "unverified", "The provider reported success without a destination transaction. The order stays unpaid.");
  }
  return routeStatusView(saved, current, deps.verify);
}
