/**
 * Transparent Zcash settlement for the hosted checkout.
 *
 * Same env as the API and worker (`loadZcashConfig` from @settlekit/chains):
 *   ZCASH_ENABLED=true, ZCASH_EXPLORER_URL, BLOCKCHAIR_API_KEY,
 *   ZCASH_MIN_CONFIRMATIONS (3), ZCASH_QUOTE_TTL_SEC (900).
 *
 * Zcash has no USD stablecoin, so a session paying in ZEC owes an exact
 * zatoshi amount locked from a USD price (Coinbase, cross-checked with
 * Kraken) plus a per-session tag that tells apart sessions paying the same
 * address (transparent addresses cannot carry a memo). Payments are found
 * with ONE address call per payTo (cached 60 s) and always re-verified by
 * txid before anything settles. Mainnet only; shielded payments are not
 * supported.
 *
 * FAIL CLOSED: when Zcash is not enabled the runtime is an error value.
 */
import { ChainConfigError, loadZcashConfig, type ZcashConfig } from "@settlekit/chains";
import type { CheckoutSession, SettlementQuote } from "@settlekit/common";
import {
  buildZip321Uri,
  createInMemoryTagLock,
  createBlockchairExplorer,
  createCoinbaseSource,
  createKrakenSource,
  formatZecAmount,
  lockQuote,
  matchZcashPayment,
  QuoteError,
  saveWithUniqueTag,
  usdToZats,
  verifyZcashTransparent,
  zcashExplorerTxUrl,
  type FetchLike,
  type PriceSource,
  type ZcashAddressActivity,
  type ZcashExplorer,
} from "@settlekit/zcash";

import type { OnChainVerification } from "./arc";
import type { CheckoutBackend } from "./backend";
import { CheckoutError } from "./errors";

type Env = Readonly<Record<string, string | undefined>>;

export interface ZcashRuntime {
  config: ZcashConfig;
  explorer: ZcashExplorer;
  /** Primary first (Coinbase), then fallbacks / cross-checks (Kraken). */
  priceSources: readonly PriceSource[];
}

export type ZcashRuntimeResult = { ok: true; runtime: ZcashRuntime } | { ok: false; error: string };

const RELEVANT_KEYS = [
  "ZCASH_ENABLED",
  "ZCASH_EXPLORER_URL",
  "BLOCKCHAIR_API_KEY",
  "ZCASH_MIN_CONFIRMATIONS",
  "ZCASH_QUOTE_TTL_SEC",
];

/** Build the runtime from `env` with an injectable fetch (no caching). */
export function loadZcashRuntime(env: Env, fetchImpl: FetchLike = globalThis.fetch as FetchLike): ZcashRuntimeResult {
  let config: ZcashConfig | null;
  try {
    config = loadZcashConfig(env);
  } catch (error) {
    if (error instanceof ChainConfigError) return { ok: false, error: `Zcash configuration error: ${error.message}` };
    throw error;
  }
  if (config === null) {
    return { ok: false, error: "Zcash payments are not enabled on this checkout (ZCASH_ENABLED is unset)." };
  }
  return {
    ok: true,
    runtime: {
      config,
      explorer: createBlockchairExplorer({
        fetch: fetchImpl,
        baseUrl: config.explorerUrl,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      }),
      priceSources: [createCoinbaseSource(fetchImpl), createKrakenSource(fetchImpl)],
    },
  };
}

let cached: { key: string; result: ZcashRuntimeResult } | undefined;

/** The process-wide Zcash runtime. */
export function getZcashRuntime(env: Env = process.env): ZcashRuntimeResult {
  const key = JSON.stringify(RELEVANT_KEYS.map((name) => env[name] ?? null));
  if (cached?.key !== key) cached = { key, result: loadZcashRuntime(env) };
  return cached.result;
}

/** Where the buyer pays on `network` (per-network override, else the default). */
export function payToForZcash(session: CheckoutSession): string {
  return session.payToByNetwork?.zcash ?? session.payToAddress;
}

/** The amount tag embedded in a session's locked quote, or null. */
export function zcashTagOf(session: CheckoutSession): number | null {
  const quote = session.settlementQuote;
  if (quote === undefined) return null;
  try {
    const tag = BigInt(quote.amountBase) - usdToZats(session.amount.amount, quote.rate);
    return tag >= 0n ? Number(tag) : null;
  } catch {
    return null;
  }
}

/** Whether `quote` still binds at `now`. */
export function isQuoteLive(quote: SettlementQuote | undefined, now: Date): quote is SettlementQuote {
  return quote !== undefined && new Date(quote.expiresAt).getTime() > now.getTime();
}

/** Tags held by OTHER open sessions with a live quote paying `payTo`. */
export function takenZcashTags(
  openSessions: readonly CheckoutSession[],
  sessionId: string,
  payTo: string,
  now: Date,
): Set<number> {
  return new Set(
    openSessions
      .filter((other) => other.id !== sessionId && isQuoteLive(other.settlementQuote, now))
      .filter((other) => payToForZcash(other) === payTo)
      .map(zcashTagOf)
      .filter((tag): tag is number => tag !== null),
  );
}

/** Fallback lock for backends without one (single process). */
const inProcessTagLock = createInMemoryTagLock();

/**
 * Save `session` with `baseQuote` (locked with tag 0) carrying a tag unique
 * among the open sessions paying `payTo`. Read-pick-save runs under the
 * backend's per-payTo lock and is re-checked after the save, so concurrent
 * sessions can never share a tag.
 */
export async function saveWithZcashTag(
  backend: Pick<CheckoutBackend, "checkouts" | "tagLock">,
  session: CheckoutSession,
  baseQuote: SettlementQuote,
  payTo: string,
  now: Date = new Date(),
): Promise<CheckoutSession> {
  return saveWithUniqueTag({
    lock: backend.tagLock ?? inProcessTagLock,
    payTo,
    sessionId: session.id,
    baseQuote,
    takenTags: async () => takenZcashTags(await backend.checkouts.findOpen(), session.id, payTo, now),
    save: (settlementQuote) => backend.checkouts.save({ ...session, settlementQuote }),
  });
}

/**
 * Lock the base ZEC quote (tag 0) for `session`; the per-session tag is added
 * atomically at save time by {@link saveWithZcashTag}.
 */
export async function lockZcashQuote(
  runtime: ZcashRuntime,
  session: CheckoutSession,
  now: Date = new Date(),
): Promise<SettlementQuote> {
  try {
    return await lockQuote({
      usdAmount: session.amount.amount,
      tag: 0,
      sources: runtime.priceSources,
      now,
      ttlSec: runtime.config.quoteTtlSec,
    });
  } catch (error) {
    if (error instanceof QuoteError) {
      throw new CheckoutError("quote_unavailable", `Could not lock a ZEC price right now: ${error.message}`);
    }
    throw error;
  }
}

/** Verify a pasted / discovered txid against the session's locked quote. */
export async function verifyZcashPayment(
  runtime: ZcashRuntime,
  session: CheckoutSession,
  txid: string,
): Promise<OnChainVerification> {
  const minConfirmations = runtime.config.minConfirmations;
  const quote = session.settlementQuote;
  if (quote === undefined) {
    return { ok: false, confirmations: 0, minConfirmations, reason: "This Zcash checkout has no locked ZEC quote." };
  }
  const result = await verifyZcashTransparent(runtime.explorer, {
    txid,
    payTo: payToForZcash(session),
    expectedZats: BigInt(quote.amountBase),
    minConfirmations,
    notBefore: new Date(session.createdAt),
    quoteExpiresAt: new Date(quote.expiresAt),
    ...(session.payerAddress ? { payer: session.payerAddress } : {}),
  });
  switch (result.status) {
    case "confirmed":
      return { ok: true, confirmations: result.confirmations, minConfirmations };
    case "pending":
      return {
        ok: false,
        pending: true,
        claimable: result.found,
        confirmations: result.confirmations,
        minConfirmations,
        reason: result.reason,
      };
    case "late":
      return { ok: false, late: true, confirmations: result.confirmations, minConfirmations, reason: result.reason };
    case "rejected":
      return { ok: false, confirmations: 0, minConfirmations, reason: result.reason };
  }
}

/** What the buyer's wallet needs to pay a session. */
export interface ZcashPaymentRequest {
  uri: string;
  address: string;
  /** Exact ZEC amount (8 dp max, trailing zeros trimmed). */
  amountZec: string;
  amountZats: string;
}

/** ZIP-321 request for the session's locked quote. */
export function buildZcashPaymentRequest(
  session: CheckoutSession,
  labels: { merchantName: string; productName: string },
): ZcashPaymentRequest {
  const quote = session.settlementQuote;
  if (quote === undefined) throw new CheckoutError("session_not_payable", "This Zcash checkout has no locked ZEC quote.");
  const address = payToForZcash(session);
  const amountZats = BigInt(quote.amountBase);
  return {
    uri: buildZip321Uri({ address, amountZats, label: labels.merchantName, message: labels.productName }),
    address,
    amountZec: formatZecAmount(amountZats),
    amountZats: amountZats.toString(),
  };
}

/** Public explorer link for a Zcash txid. */
export function zcashTxUrl(txid: string): string {
  return zcashExplorerTxUrl("mainnet", txid) ?? "";
}

// --- address scan (one explorer call per payTo per minute) ------------------

export const ADDRESS_CACHE_TTL_MS = 60_000;
export const ADDRESS_ACTIVITY_LIMIT = 50;

export interface AddressActivityCache {
  get(payTo: string, now: number): readonly ZcashAddressActivity[] | undefined;
  set(payTo: string, activity: readonly ZcashAddressActivity[], now: number): void;
}

/** In-memory TTL cache of address activity keyed by payTo. */
export function createAddressActivityCache(ttlMs: number = ADDRESS_CACHE_TTL_MS): AddressActivityCache {
  const entries = new Map<string, { at: number; activity: readonly ZcashAddressActivity[] }>();
  return {
    get(payTo, now) {
      const entry = entries.get(payTo);
      if (entry === undefined || now - entry.at >= ttlMs) return undefined;
      return entry.activity;
    },
    set(payTo, activity, now) {
      entries.set(payTo, { at: now, activity });
    },
  };
}

const processCache = createAddressActivityCache();

export type ZcashScanResult =
  | { status: "found"; txid: string }
  | { status: "none" }
  | { status: "unavailable"; reason: string };

/** Find the session's payment among recent activity on its payTo (cached). */
export async function scanZcashPayment(
  runtime: ZcashRuntime,
  session: CheckoutSession,
  options: { cache?: AddressActivityCache; now?: Date } = {},
): Promise<ZcashScanResult> {
  const quote = session.settlementQuote;
  if (quote === undefined) return { status: "none" };
  const cache = options.cache ?? processCache;
  const now = (options.now ?? new Date()).getTime();
  const payTo = payToForZcash(session);
  let activity = cache.get(payTo, now);
  if (activity === undefined) {
    const fetched = await runtime.explorer.getAddressActivity(payTo, ADDRESS_ACTIVITY_LIMIT);
    if (!fetched.ok) return { status: "unavailable", reason: fetched.reason };
    activity = fetched.value;
    cache.set(payTo, activity, now);
  }
  const match = matchZcashPayment(activity, {
    expectedZats: BigInt(quote.amountBase),
    notBefore: new Date(session.createdAt),
  });
  return match === null ? { status: "none" } : { status: "found", txid: match.txid };
}
