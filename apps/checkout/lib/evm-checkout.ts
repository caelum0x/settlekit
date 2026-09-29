/**
 * EVM checkout flow (server side).
 *
 *   1. `getEvmPaymentParams` returns everything the buyer's wallet needs:
 *      chain id + add-chain parameters (PUBLIC registry RPC, never the
 *      configured one, which may embed an API key), token, exact base-unit
 *      amount, payTo and, on Tempo, the keccak256(sessionId) memo.
 *   2. `declareEvmPayer` saves the buyer's delivery fields and binds the
 *      connected wallet as the payer: only a transfer FROM it can settle.
 *   3. The wallet sends the transfer; the page polls the confirm route with
 *      the tx hash until the chain reaches the configured depth.
 */
import { getAddress, isAddress } from "viem";
import { isEvmNetwork, sessionMemo, viemChainFor, type EvmChainKey } from "@settlekit/chains";
import { toBaseUnits, type CheckoutSession } from "@settlekit/common";

import { CheckoutError } from "./errors";
import { enabledEvmChain } from "./evm";
import { buildAddChainParams, type AddEthereumChainParameter, type Hex } from "./evm-wallet";
import { requiredFieldsForDelivery, sanitizeFields, validateFields } from "./fields";
import { networkUnavailableReason } from "./network-options";
import { defaultStoreDeps, getResolvedSession, hasRecordedPayment, type StoreDeps } from "./store";
import { payToFor } from "./verify-payment";

/** GET evm/params response. */
export interface EvmPaymentParams {
  network: EvmChainKey;
  chainId: number;
  chainName: string;
  env: "mainnet" | "testnet";
  token: { address: Hex; symbol: string; decimals: number };
  /** Decimal amount owed (major units). */
  amount: string;
  /** Exact amount in token base units. */
  amountBase: string;
  payTo: Hex;
  /** Tempo TIP-20 memo binding the transfer to this session; null elsewhere. */
  memo: Hex | null;
  /** Tempo: only transferWithMemo carrying `memo` settles (plain transfers are refused). */
  memoRequired: boolean;
  minConfirmations: number;
  /** Explorer tx URL prefix, or null when the chain has no public explorer. */
  explorerTxBase: string | null;
  addChain: AddEthereumChainParameter;
  /** Wallet already bound as payer, if any. */
  payerAddress: string | null;
}

async function payableEvmSession(sessionId: string, deps: StoreDeps): Promise<{ session: CheckoutSession; key: EvmChainKey }> {
  const resolved = await getResolvedSession(sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const { session } = resolved;
  if (session.status === "completed") throw new CheckoutError("session_not_payable", "This checkout session has already been paid.");
  if (session.status !== "open" || resolved.expired) {
    throw new CheckoutError("session_not_payable", "This checkout session has expired and can no longer be paid.");
  }
  const network = session.network;
  if (!isEvmNetwork(network)) {
    throw new CheckoutError("session_not_payable", "This checkout session is not paid on an EVM network.");
  }
  const unavailable = networkUnavailableReason(session, network, deps.verify);
  if (unavailable !== undefined) throw new CheckoutError("network_not_configured", unavailable);
  return { session, key: network };
}

/** Wallet parameters for paying `sessionId` on its EVM network. */
export async function getEvmPaymentParams(
  sessionId: string,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<EvmPaymentParams> {
  const { session, key } = await payableEvmSession(sessionId, deps);
  const chain = enabledEvmChain(deps.verify.evm, key);
  if (chain === undefined) throw new CheckoutError("network_not_configured", `${key} payments are not enabled on this checkout.`);
  const { spec } = chain;
  const explorerTxBase = spec.explorerTx("");
  return {
    network: key,
    chainId: spec.chainId,
    chainName: spec.name,
    env: spec.env,
    token: { address: chain.tokenAddress, symbol: spec.token.symbol, decimals: spec.token.decimals },
    amount: session.amount.amount,
    amountBase: toBaseUnits(session.amount.amount).toString(),
    payTo: getAddress(payToFor(session, key)),
    memo: key === "tempo" ? sessionMemo(session.id) : null,
    memoRequired: key === "tempo" && session.requireMemo === true,
    minConfirmations: chain.minConfirmations,
    explorerTxBase,
    addChain: buildAddChainParams({
      chainId: spec.chainId,
      name: spec.name,
      rpcUrl: spec.defaultRpcUrl,
      nativeCurrency: viemChainFor(spec).nativeCurrency,
      explorerTxBase,
    }),
    payerAddress: session.payerAddress ?? null,
  };
}

export interface DeclarePayerInput {
  sessionId: string;
  payer: unknown;
  fields: Record<string, unknown>;
}

/** Save delivery fields and bind the connected wallet as the session's payer. */
export async function declareEvmPayer(
  input: DeclarePayerInput,
  deps: StoreDeps = defaultStoreDeps(),
): Promise<{ payerAddress: string }> {
  const raw = typeof input.payer === "string" ? input.payer.trim() : "";
  if (!isAddress(raw, { strict: false })) {
    throw new CheckoutError("invalid_request", "payer must be a 0x-prefixed 20-byte wallet address.");
  }
  const payerAddress = getAddress(raw);
  const { session } = await payableEvmSession(input.sessionId, deps);
  if (await hasRecordedPayment(deps.backend, session.id)) {
    throw new CheckoutError("session_not_payable", "A payment is already recorded for this checkout.");
  }
  const resolved = await getResolvedSession(input.sessionId, deps);
  if (!resolved) throw new CheckoutError("session_not_found", "Checkout session not found.");
  const specs = requiredFieldsForDelivery(resolved.deliveryAction);
  const errors = validateFields(specs, input.fields);
  if (errors.length > 0) throw new CheckoutError("fields_incomplete", errors.join(" "));
  await deps.backend.checkouts.save({
    ...session,
    payerAddress,
    collectedFields: { ...session.collectedFields, ...sanitizeFields(specs, input.fields) },
  });
  return { payerAddress };
}
