/**
 * Zcash checkout flow (server side).
 *
 *   1. `prepareZcashPayment` saves the buyer's delivery fields and returns
 *      the ZIP-321 request for the session's locked quote (QR payload,
 *      address, exact ZEC amount, quote expiry).
 *   2. `getZcashStatus` (polled) looks for the payment: a txid already
 *      claimed for the session (by this checkout or the worker's watcher),
 *      else one cached address scan per payTo per minute matched by the exact
 *      tagged amount. Any txid is re-verified in full before it settles.
 *   3. A payment mined after the quote expired is held for manual review.
 */
import type { CheckoutSession, Payment, SettlementQuote } from "@settlekit/common";

import { CheckoutError, isCheckoutError } from "./errors";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import { networkUnavailableReason } from "./network-options";
import {
  defaultStoreDeps,
  getConfirmedPayment,
  getResolvedSession,
  recordAndConfirm,
  saveCollectedFields,
  type StoreDeps,
} from "./store";
import {
  buildZcashPaymentRequest,
  isQuoteLive,
  scanZcashPayment,
  zcashTxUrl,
  type AddressActivityCache,
  type ZcashRuntime,
} from "./zcash";

/** POST zcash/uri response. */
export interface ZcashUriResponse {
  uri: string;
  address: string;
  amountZec: string;
  amountZats: string;
  /** USD amount the quote covers. */
  usdAmount: string;
  quote: Pick<SettlementQuote, "rate" | "source" | "lockedAt" | "expiresAt">;
  quoteExpired: boolean;
  minConfirmations: number;
}

/** GET zcash/status response. */
export type ZcashStatusResponse =
  | { status: "waiting"; quoteExpired: boolean; note?: string }
  | { status: "confirming"; txHash: string; explorerUrl: string; message: string }
  | { status: "review"; txHash: string; explorerUrl: string; message: string }
  | { status: "paid"; txHash: string; explorerUrl: string };

async function zcashSession(
  sessionId: string,
  deps: StoreDeps,
): Promise<{ session: CheckoutSession; runtime: ZcashRuntime; merchantName: string; productName: string; expired: boolean }> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  if (session.network !== "zcash") {
    throw new CheckoutError("session_not_payable", "This checkout session is not paid in Zcash.");
  }
  const zcash = deps.verify.zcash;
  if (zcash === undefined || !zcash.ok) {
    throw new CheckoutError("network_not_configured", zcash?.error ?? "Zcash payments are not enabled on this checkout.");
  }
  return {
    session,
    runtime: zcash.runtime,
    merchantName: resolved.merchantName,
    productName: resolved.product.name,
    expired: resolved.expired,
  };
}

/** Save buyer fields and return the ZIP-321 request for the locked quote. */
export async function prepareZcashPayment(
  input: { sessionId: string; fields: Record<string, unknown> },
  deps: StoreDeps = defaultStoreDeps(),
  now: Date = new Date(),
): Promise<ZcashUriResponse> {
  const { session, runtime, merchantName, productName, expired } = await zcashSession(input.sessionId, deps);
  if (session.status === "completed") throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  if (session.status !== "open" || expired) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  const unavailable = networkUnavailableReason(session, "zcash", deps.verify);
  if (unavailable !== undefined) throw new CheckoutError("network_not_configured", unavailable);
  const quote = session.settlementQuote;
  if (quote === undefined) {
    throw new CheckoutError("session_not_payable", "Choose Zcash again to lock a ZEC price for this checkout.");
  }
  const resolved = await getResolvedSession(input.sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const errors = validateFields(specs, input.fields);
  if (errors.length > 0) throw new CheckoutError("fields_incomplete", errors.join(" "));
  await saveCollectedFields(input.sessionId, sanitizeFields(specs, input.fields), deps);

  const request = buildZcashPaymentRequest(session, { merchantName, productName });
  return {
    ...request,
    usdAmount: session.amount.amount,
    quote: { rate: quote.rate, source: quote.source, lockedAt: quote.lockedAt, expiresAt: quote.expiresAt },
    quoteExpired: !isQuoteLive(quote, now),
    minConfirmations: runtime.config.minConfirmations,
  };
}

/** Run the full verification for a known txid and translate the outcome. */
async function settle(sessionId: string, txHash: string, deps: StoreDeps): Promise<ZcashStatusResponse | null> {
  const explorerUrl = zcashTxUrl(txHash);
  try {
    const { payment } = await recordAndConfirm(sessionId, txHash, deps);
    return { status: "paid", txHash: payment.txHash ?? txHash, explorerUrl };
  } catch (error) {
    if (!isCheckoutError(error)) throw error;
    if (error.code === "payment_pending") return { status: "confirming", txHash, explorerUrl, message: error.message };
    if (error.code === "payment_under_review") return { status: "review", txHash, explorerUrl, message: error.message };
    if (error.code === "verification_failed" || error.code === "duplicate_tx") {
      console.warn(`[checkout] zcash tx ${txHash} did not settle session ${sessionId}: ${error.message}`);
      return null;
    }
    throw error;
  }
}

function claimedTxid(payments: readonly Payment[]): string | undefined {
  return payments.find((payment) => payment.status === "pending" && payment.network === "zcash" && payment.txHash)?.txHash;
}

/** Poll for the session's Zcash payment and settle it once final. */
export async function getZcashStatus(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
  options: { cache?: AddressActivityCache; now?: Date } = {},
): Promise<ZcashStatusResponse> {
  const now = options.now ?? new Date();
  const { session, runtime } = await zcashSession(sessionId, deps);
  if (session.status === "completed") {
    const payment = await getConfirmedPayment(sessionId, deps);
    if (payment?.txHash) return { status: "paid", txHash: payment.txHash, explorerUrl: zcashTxUrl(payment.txHash) };
  }
  const quoteExpired = !isQuoteLive(session.settlementQuote, now);

  const claimed = claimedTxid(await deps.backend.payments.findByCheckoutSessionId(sessionId));
  if (claimed !== undefined) {
    return (await settle(sessionId, claimed, deps)) ?? { status: "waiting", quoteExpired };
  }
  if (session.status !== "open") return { status: "waiting", quoteExpired };

  const scan = await scanZcashPayment(runtime, session, { ...(options.cache ? { cache: options.cache } : {}), now });
  if (scan.status === "unavailable") {
    return { status: "waiting", quoteExpired, note: "The Zcash explorer is busy; still watching for your payment." };
  }
  if (scan.status === "none") return { status: "waiting", quoteExpired };
  return (await settle(sessionId, scan.txid, deps)) ?? { status: "waiting", quoteExpired };
}
