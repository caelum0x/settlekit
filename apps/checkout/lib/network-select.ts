/**
 * Buyer network selection for a checkout session.
 *
 * The buyer may switch between the networks the merchant accepted while the
 * session is open and NOTHING is recorded against it yet (no pending or
 * confirmed payment): after that the network is fixed, so a claimed or
 * settled payment can never be re-interpreted on another chain.
 *
 * Switching sets `network` + the payTo for it (every accepted network's
 * payTo is pinned into `payToByNetwork` first, so the merchant's default
 * address is never lost), clears the declared payer (it belongs to the old
 * chain), makes sure Solana has a reference and locks a ZEC quote for Zcash.
 * A live quote is kept as is: re-selecting Zcash never re-prices. While an
 * any-token route is moving funds (past "quoted", not refunded/failed) the
 * network is fixed too.
 */
import { isPaymentNetwork, type CheckoutSession, type PaymentNetwork } from "@settlekit/common";
import { isSessionExpired } from "@settlekit/payments";
import { createReference } from "@settlekit/solana";

import { CheckoutError } from "./errors";
import { acceptedNetworksOf, networkUnavailableReason } from "./network-options";
import { defaultStoreDeps, hasRecordedPayment, type StoreDeps } from "./store";
import { payToFor } from "./verify-payment";
import { isQuoteLive, lockZcashQuote, saveWithZcashTag } from "./zcash";

/** Pin every accepted network's payTo so switching never loses the default. */
function pinnedPayTo(session: CheckoutSession): Partial<Record<PaymentNetwork, string>> {
  return Object.fromEntries(acceptedNetworksOf(session).map((network) => [network, payToFor(session, network)]));
}

/** Load a session and assert its network (or price) may still change. */
export async function switchableSession(sessionId: string, deps: StoreDeps, now: Date): Promise<CheckoutSession> {
  const session = await deps.backend.checkouts.findById(sessionId);
  if (!session) throw new CheckoutError("session_not_found", "Checkout session not found.");
  if (session.status === "completed") {
    throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  }
  if (session.status !== "open" || isSessionExpired(session, now)) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  const route = session.route;
  if (route !== undefined && route.state !== "quoted" && route.state !== "refund" && route.state !== "failure") {
    throw new CheckoutError(
      "session_not_payable",
      "A cross-chain payment for this checkout is in progress, so its network can no longer change.",
    );
  }
  if (await hasRecordedPayment(deps.backend, session.id)) {
    throw new CheckoutError(
      "session_not_payable",
      "A payment is already recorded for this checkout, so its network can no longer change.",
    );
  }
  return session;
}

/**
 * Add the per-network bindings the chosen network needs and save. A fresh
 * Zcash quote is saved through {@link saveWithZcashTag}, which picks the
 * session's amount tag atomically per payTo.
 */
export async function bindAndSave(
  session: CheckoutSession,
  network: PaymentNetwork,
  deps: StoreDeps,
  now: Date,
): Promise<CheckoutSession> {
  if (network === "solana" && session.paymentReference === undefined) {
    return deps.backend.checkouts.save({ ...session, paymentReference: createReference() });
  }
  if (network !== "zcash" || isQuoteLive(session.settlementQuote, now)) return deps.backend.checkouts.save(session);
  const zcash = deps.verify.zcash;
  if (zcash === undefined || !zcash.ok) {
    throw new CheckoutError("network_not_configured", zcash?.error ?? "Zcash payments are not enabled on this checkout.");
  }
  const baseQuote = await lockZcashQuote(zcash.runtime, session, now);
  return saveWithZcashTag(deps.backend, session, baseQuote, payToFor(session, "zcash"), now);
}

/** Switch `sessionId` to `rawNetwork`; returns the saved session. */
export async function selectNetwork(
  sessionId: string,
  rawNetwork: unknown,
  deps: StoreDeps = defaultStoreDeps(),
  now: Date = new Date(),
): Promise<CheckoutSession> {
  if (typeof rawNetwork !== "string" || !isPaymentNetwork(rawNetwork)) {
    throw new CheckoutError("invalid_request", "network must be one of the supported payment networks.");
  }
  const network: PaymentNetwork = rawNetwork;
  const session = await switchableSession(sessionId, deps, now);
  if (!acceptedNetworksOf(session).includes(network)) {
    throw new CheckoutError("network_not_accepted", `The merchant does not accept ${network} on this checkout.`);
  }
  const unavailable = networkUnavailableReason(session, network, deps.verify);
  if (unavailable !== undefined) throw new CheckoutError("network_not_configured", unavailable);

  const payToByNetwork = pinnedPayTo(session);
  const { payerAddress: _payer, ...rest } = session;
  const switched: CheckoutSession = {
    ...(network === session.network ? session : rest),
    network,
    payToAddress: payToByNetwork[network] ?? session.payToAddress,
    payToByNetwork,
  };
  return bindAndSave(switched, network, deps, now);
}
