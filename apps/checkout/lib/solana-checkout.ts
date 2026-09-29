/**
 * Solana Pay checkout flow (server side).
 *
 *   1. `prepareSolanaPayment` validates + saves the buyer's delivery fields and
 *      returns the Solana Pay request for the session: a transfer-request URL
 *      (the QR payload) carrying the session's reference, plus the
 *      transaction-request URL for wallets that fetch a server-built tx.
 *   2. `buildSolanaTransaction` builds the unsigned USDC payment transaction for
 *      a connected wallet: idempotent merchant ATA create + TransferChecked
 *      with the reference attached read-only. The buyer's wallet signs + sends.
 *   3. Payment is then found by reference (`confirmFromReference`, polled by the
 *      status route) and verified against the session — never trusted from the
 *      client.
 */
import { toBaseUnits } from "@settlekit/common";
import {
  SOLANA_USDC_DECIMALS,
  buildUsdcPaymentTx,
  encodeTransactionRequestUrl,
  encodeTransferRequestUrl,
  isSolanaAddress,
} from "@settlekit/solana";

import { CheckoutError } from "./errors";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import type { SolanaRuntime } from "./solana";
import {
  defaultStoreDeps,
  getResolvedSession,
  saveCollectedFields,
  type ResolvedSession,
  type StoreDeps,
} from "./store";
import type { SolanaPayUrlResponse, SolanaTxResponse } from "./types";

interface PayableSolanaSession {
  resolved: ResolvedSession;
  runtime: SolanaRuntime;
  reference: string;
}

/** Load a session and assert it can be paid on Solana right now. */
async function payableSolanaSession(sessionId: string, deps: StoreDeps): Promise<PayableSolanaSession> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  if (session.network !== "solana") {
    throw new CheckoutError("session_not_payable", "This checkout session is not paid on Solana.");
  }
  if (session.status === "completed") {
    throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  }
  if (session.status !== "open" || resolved.expired) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  if (!deps.verify.solana.ok) throw new CheckoutError("network_not_configured", deps.verify.solana.error);
  if (session.paymentReference === undefined) {
    throw new CheckoutError("missing_reference", "This Solana checkout session has no payment reference.");
  }
  return { resolved, runtime: deps.verify.solana.runtime, reference: session.paymentReference };
}

/** The transaction-request endpoint for a session on `origin`. */
export function solanaTxEndpoint(origin: string, sessionId: string): string {
  return `${origin.replace(/\/$/, "")}/api/v1/checkout-sessions/${encodeURIComponent(sessionId)}/solana/tx`;
}

export interface PrepareSolanaPaymentInput {
  sessionId: string;
  fields: Record<string, unknown>;
  /** Public origin of this checkout (for the transaction-request link). */
  origin: string;
}

/** Save buyer fields and return the Solana Pay request for the session. */
export async function prepareSolanaPayment(
  input: PrepareSolanaPaymentInput,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<SolanaPayUrlResponse> {
  const { resolved, runtime, reference } = await payableSolanaSession(input.sessionId, deps);
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const errors = validateFields(specs, input.fields);
  if (errors.length > 0) throw new CheckoutError("fields_incomplete", errors.join(" "));
  await saveCollectedFields(input.sessionId, sanitizeFields(specs, input.fields), deps);

  const { session, merchantName, product } = resolved;
  const transferUrl = encodeTransferRequestUrl(
    {
      recipient: session.payToAddress,
      amount: session.amount.amount,
      splToken: runtime.config.usdcMint,
      references: [reference],
      label: merchantName,
      message: product.name,
    },
    { maxDecimals: SOLANA_USDC_DECIMALS },
  );
  // Solana Pay transaction requests must be https; plain-http dev origins
  // still get the transfer request (QR) and the in-page wallet flow.
  const transactionUrl = input.origin.startsWith("https://")
    ? encodeTransactionRequestUrl({ link: solanaTxEndpoint(input.origin, input.sessionId) })
    : null;
  return { transferUrl, transactionUrl, reference, cluster: runtime.config.cluster };
}

/** Solana Pay transaction-request GET: how the wallet labels the merchant. */
export async function describeSolanaMerchant(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<{ label: string }> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  return { label: resolved.merchantName };
}

/** Build the unsigned USDC payment transaction for the buyer's `account`. */
export async function buildSolanaTransaction(
  input: { sessionId: string; account: unknown },
  deps: StoreDeps = defaultStoreDeps(),
): Promise<SolanaTxResponse> {
  const account = typeof input.account === "string" ? input.account.trim() : "";
  if (!isSolanaAddress(account)) {
    throw new CheckoutError("invalid_request", "account must be a base58 Solana wallet address.");
  }
  const { resolved, runtime, reference } = await payableSolanaSession(input.sessionId, deps);
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  if (validateFields(specs, resolved.session.collectedFields).length > 0) {
    throw new CheckoutError("fields_incomplete", "Enter your delivery details on the checkout page before paying.");
  }

  const { session, merchantName, product } = resolved;
  const latestBlockhash = await runtime.rpc.getLatestBlockhash(runtime.config.commitment);
  const built = await buildUsdcPaymentTx({
    buyer: account,
    recipientOwner: session.payToAddress,
    mint: runtime.config.usdcMint,
    amount: toBaseUnits(session.amount.amount),
    reference,
    latestBlockhash,
  });
  return { transaction: built.transaction, message: `${merchantName}: ${product.name}` };
}
