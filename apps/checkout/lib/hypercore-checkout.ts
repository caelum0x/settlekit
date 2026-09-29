/**
 * HyperCore checkout flow (server side).
 *
 *   1. `getHyperCorePaymentParams` returns what the buyer's EVM wallet signs:
 *      the `usdSend` EIP-712 domain/types, destination (payTo), canonical
 *      USD amount and `hyperliquidChain` for this deployment.
 *   2. `submitHyperCorePayment` validates the signed action against the
 *      SESSION (destination, amount, chain, fresh nonce), recovers the
 *      signer, binds it as the payer, saves the delivery fields and submits
 *      the action to Hyperliquid through @nktkas/hyperliquid.
 *   3. The transfer is then located in the payee's ledger (signer + nonce)
 *      and settled through the same fail-closed path as every network
 *      (`recordAndConfirm`: hash uniqueness → 409, full re-verification).
 *
 * A manual hash can always be pasted instead (PaymentForm → confirm route).
 */
import { toBaseUnits, type CheckoutSession } from "@settlekit/common";
import {
  buildUsdSendAction,
  canonicalUsdAmount,
  HyperCoreSubmitError,
  HYPERLIQUID_SIGN_DOMAIN_NAME,
  hyperCoreTxUrl,
  recoverUsdSendSigner,
  splitSignature,
  USD_SEND_PRIMARY_TYPE,
  USD_SEND_TYPES,
  UsdSendError,
  verifyHyperCoreTransfer,
  type HyperliquidChain,
  type Signature,
  type UsdSendAction,
} from "@settlekit/hyperliquid";

import { CheckoutError, isCheckoutError } from "./errors";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import { hyperCorePayTo, type HyperCoreRuntime } from "./hypercore";
import { networkUnavailableReason } from "./network-options";
import { defaultStoreDeps, getConfirmedPayment, getResolvedSession, hasRecordedPayment, recordAndConfirm, type StoreDeps } from "./store";

/** A signed nonce may be this old when submitted (wallet prompt time). */
export const MAX_NONCE_AGE_MS = 5 * 60_000;
/** ...or this far in the future (client clock skew). */
export const MAX_NONCE_AHEAD_MS = 60_000;

/** GET hypercore/params response. */
export interface HyperCorePaymentParams {
  network: "hypercore";
  env: "mainnet" | "testnet";
  hyperliquidChain: HyperliquidChain;
  /** payTo, lowercase (signed verbatim). */
  destination: `0x${string}`;
  /** Canonical USD amount string to sign ("25.5"). */
  amount: string;
  amountBase: string;
  domain: { name: string; version: "1"; verifyingContract: `0x${string}` };
  primaryType: typeof USD_SEND_PRIMARY_TYPE;
  types: typeof USD_SEND_TYPES;
  payerAddress: string | null;
  explorerTxBase: string;
}

/** POST hypercore/submit and hypercore/status response. */
export type HyperCoreStatusResponse =
  | { status: "waiting"; nonce: number; message: string }
  | { status: "paid"; txHash: string; explorerUrl: string }
  | { status: "failed"; reason: string };

async function payableHyperCoreSession(
  sessionId: string,
  deps: StoreDeps,
): Promise<{ session: CheckoutSession; runtime: HyperCoreRuntime }> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  if (session.status === "completed") throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  if (session.status !== "open" || resolved.expired) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  if (session.network !== "hypercore") {
    throw new CheckoutError("session_not_payable", "This checkout session is not paid on HyperCore.");
  }
  const unavailable = networkUnavailableReason(session, "hypercore", deps.verify);
  if (unavailable !== undefined) throw new CheckoutError("network_not_configured", unavailable);
  const hypercore = deps.verify.hypercore;
  if (hypercore === undefined || !hypercore.ok) {
    throw new CheckoutError("network_not_configured", hypercore?.error ?? "HyperCore payments are not enabled on this checkout.");
  }
  return { session, runtime: hypercore.runtime };
}

/** What the buyer's wallet signs for `sessionId`. */
export async function getHyperCorePaymentParams(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<HyperCorePaymentParams> {
  const { session, runtime } = await payableHyperCoreSession(sessionId, deps);
  const { config } = runtime;
  return {
    network: "hypercore",
    env: config.network,
    hyperliquidChain: config.hyperliquidChain,
    destination: hyperCorePayTo(session).toLowerCase() as `0x${string}`,
    amount: canonicalUsdAmount(session.amount.amount),
    amountBase: toBaseUnits(session.amount.amount).toString(),
    domain: { name: HYPERLIQUID_SIGN_DOMAIN_NAME, version: "1", verifyingContract: "0x0000000000000000000000000000000000000000" },
    primaryType: USD_SEND_PRIMARY_TYPE,
    types: USD_SEND_TYPES,
    payerAddress: session.payerAddress ?? null,
    explorerTxBase: hyperCoreTxUrl("", config.network),
  };
}

export interface SubmitHyperCoreInput {
  sessionId: string;
  action: unknown;
  signature: unknown;
  fields: Record<string, unknown>;
}

function field<T>(record: Record<string, unknown>, key: string, check: (value: unknown) => value is T): T {
  const value = record[key];
  if (!check(value)) throw new CheckoutError("invalid_request", `action.${key} is missing or invalid.`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";

/** Rebuild the signed action from untrusted JSON and bind it to the session. */
export function parseSessionAction(
  raw: unknown,
  session: CheckoutSession,
  runtime: HyperCoreRuntime,
  now: Date,
): UsdSendAction {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CheckoutError("invalid_request", "action must be the signed usdSend object.");
  }
  const record = raw as Record<string, unknown>;
  if (record.type !== "usdSend") throw new CheckoutError("invalid_request", "action.type must be usdSend.");
  let action: UsdSendAction;
  try {
    action = buildUsdSendAction({
      destination: field(record, "destination", isString),
      amount: field(record, "amount", isString),
      time: field(record, "time", isNumber),
      hyperliquidChain: field(record, "hyperliquidChain", isString) as HyperliquidChain,
      signatureChainId: field(record, "signatureChainId", isString),
    });
  } catch (error) {
    if (error instanceof UsdSendError) throw new CheckoutError("invalid_request", error.message);
    throw error;
  }
  if (action.destination !== hyperCorePayTo(session).toLowerCase()) {
    throw new CheckoutError("verification_failed", "The signed transfer does not pay this checkout's address.");
  }
  if (action.amount !== canonicalUsdAmount(session.amount.amount)) {
    throw new CheckoutError("verification_failed", "The signed amount does not match the amount due.");
  }
  if (action.hyperliquidChain !== runtime.config.hyperliquidChain) {
    throw new CheckoutError("verification_failed", `This checkout settles on Hyperliquid ${runtime.config.hyperliquidChain}.`);
  }
  const age = now.getTime() - action.time;
  if (age > MAX_NONCE_AGE_MS || age < -MAX_NONCE_AHEAD_MS || action.time < new Date(session.createdAt).getTime()) {
    throw new CheckoutError("invalid_request", "The signature is stale; sign the transfer again.");
  }
  return action;
}

function parseSignature(raw: unknown): Signature {
  if (typeof raw !== "string") throw new CheckoutError("invalid_request", "signature must be a 0x hex string.");
  try {
    return splitSignature(raw);
  } catch (error) {
    if (error instanceof UsdSendError) throw new CheckoutError("invalid_request", error.message);
    throw error;
  }
}

/** Find the submitted transfer in the payee's ledger and settle it when found. */
export async function settleHyperCoreSubmission(
  sessionId: string,
  nonce: number,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<HyperCoreStatusResponse> {
  const session = await deps.backend.checkouts.findById(sessionId);
  if (!session) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const hypercore = deps.verify.hypercore;
  if (hypercore === undefined || !hypercore.ok) {
    throw new CheckoutError("network_not_configured", hypercore?.error ?? "HyperCore payments are not enabled on this checkout.");
  }
  const explorer = (hash: string) => hyperCoreTxUrl(hash, hypercore.runtime.config.network);
  if (session.status === "completed") {
    const payment = await getConfirmedPayment(sessionId, deps);
    if (payment?.txHash) return { status: "paid", txHash: payment.txHash, explorerUrl: explorer(payment.txHash) };
  }
  if (session.network !== "hypercore" || session.payerAddress === undefined) {
    throw new CheckoutError("session_not_payable", "No HyperCore transfer was submitted for this checkout.");
  }
  if (!Number.isSafeInteger(nonce) || nonce <= 0) throw new CheckoutError("invalid_request", "nonce must be the signed action time.");
  const found = await verifyHyperCoreTransfer(hypercore.runtime.client, {
    submitted: { sender: session.payerAddress, nonce },
    payTo: hyperCorePayTo(session),
    expectedBase: toBaseUnits(session.amount.amount),
    notBefore: new Date(session.createdAt),
    payer: session.payerAddress,
  });
  if (!found.ok) {
    if (found.retryable) return { status: "waiting", nonce, message: found.reason };
    return { status: "failed", reason: found.reason };
  }
  try {
    const { payment } = await recordAndConfirm(sessionId, found.hash, deps);
    const txHash = payment.txHash ?? found.hash;
    return { status: "paid", txHash, explorerUrl: explorer(txHash) };
  } catch (error) {
    if (isCheckoutError(error) && error.code === "payment_pending") return { status: "waiting", nonce, message: error.message };
    throw error;
  }
}

/** Validate, bind, submit and (when already visible) settle a signed usdSend. */
export async function submitHyperCorePayment(
  input: SubmitHyperCoreInput,
  deps: StoreDeps = defaultStoreDeps(),
  now: Date = new Date(),
): Promise<HyperCoreStatusResponse> {
  const { session, runtime } = await payableHyperCoreSession(input.sessionId, deps);
  if (await hasRecordedPayment(deps.backend, session.id)) {
    throw new CheckoutError("session_not_payable", "A payment is already recorded for this checkout.");
  }
  const action = parseSessionAction(input.action, session, runtime, now);
  const signature = parseSignature(input.signature);
  const signer = await recoverUsdSendSigner(action, signature);
  if (session.payerAddress !== undefined && session.payerAddress.toLowerCase() !== signer.toLowerCase()) {
    throw new CheckoutError("verification_failed", "This checkout is bound to another wallet.");
  }

  const resolved = await getResolvedSession(input.sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const errors = validateFields(specs, input.fields);
  if (errors.length > 0) throw new CheckoutError("fields_incomplete", errors.join(" "));
  await deps.backend.checkouts.save({
    ...session,
    payerAddress: signer,
    collectedFields: { ...session.collectedFields, ...sanitizeFields(specs, input.fields) },
  });

  try {
    await runtime.client.submitUsdSend(action, signature);
  } catch (error) {
    if (error instanceof HyperCoreSubmitError) {
      throw new CheckoutError(error.rejected ? "verification_failed" : "provider_unavailable", error.message);
    }
    throw error;
  }
  return settleHyperCoreSubmission(input.sessionId, action.time, deps);
}
