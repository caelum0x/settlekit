/**
 * HyperCore (Hyperliquid L1) settlement runtime for the hosted checkout.
 *
 * Same env as the API and worker (`loadHyperCoreConfig` from
 * @settlekit/hyperliquid): HYPERCORE_ENABLED, HYPERCORE_NETWORK,
 * HYPERCORE_API_URL. The buyer's EVM wallet signs a `usdSend` (EIP-712);
 * payments are verified against the payee's non-funding ledger.
 *
 * FAIL CLOSED: when HyperCore is not enabled the runtime is an error value
 * and no HyperCore payment can settle a session.
 */
import { ChainConfigError, normalizeTxHash } from "@settlekit/chains";
import { toBaseUnits, type CheckoutSession } from "@settlekit/common";
import {
  createHyperCoreClient,
  loadHyperCoreConfig,
  verifyHyperCoreTransfer,
  type HyperCoreClient,
  type HyperCoreConfig,
  type HyperCoreVerification,
  type HyperliquidTransport,
} from "@settlekit/hyperliquid";

import type { OnChainVerification } from "./arc";

type Env = Readonly<Record<string, string | undefined>>;

export interface HyperCoreRuntime {
  config: HyperCoreConfig;
  client: HyperCoreClient;
}

export type HyperCoreRuntimeResult = { ok: true; runtime: HyperCoreRuntime } | { ok: false; error: string };

const RELEVANT_KEYS = ["HYPERCORE_ENABLED", "HYPERCORE_NETWORK", "HYPERCORE_API_URL", "SETTLEKIT_CHAIN_ENV"];

/** Build the runtime from `env` (no caching); tests inject a transport. */
export function loadHyperCoreRuntime(env: Env, transport?: HyperliquidTransport): HyperCoreRuntimeResult {
  let config: HyperCoreConfig | null;
  try {
    config = loadHyperCoreConfig(env);
  } catch (error) {
    if (error instanceof ChainConfigError) return { ok: false, error: `HyperCore configuration error: ${error.message}` };
    throw error;
  }
  if (config === null) {
    return { ok: false, error: "HyperCore payments are not enabled on this checkout (HYPERCORE_ENABLED is unset)." };
  }
  return { ok: true, runtime: { config, client: createHyperCoreClient(config, transport ? { transport } : {}) } };
}

let cached: { key: string; result: HyperCoreRuntimeResult } | undefined;

/** The process-wide HyperCore runtime (rebuilt when its env changes). */
export function getHyperCoreRuntime(env: Env = process.env): HyperCoreRuntimeResult {
  const key = JSON.stringify(RELEVANT_KEYS.map((name) => env[name] ?? null));
  if (cached?.key !== key) cached = { key, result: loadHyperCoreRuntime(env) };
  return cached.result;
}

/** Where the buyer pays on HyperCore. */
export function hyperCorePayTo(session: CheckoutSession): string {
  return session.payToByNetwork?.hypercore ?? session.payToAddress;
}

/** Map the ledger verifier outcome onto the checkout's verification shape. */
export function fromHyperCoreVerification(result: HyperCoreVerification): OnChainVerification {
  if (result.ok) return { ok: true, confirmations: 1, minConfirmations: 1 };
  return {
    ok: false,
    confirmations: 0,
    minConfirmations: 1,
    reason: result.reason,
    ...(result.retryable ? { pending: true } : {}),
  };
}

export interface HyperCoreVerifyOptions {
  /** The hash came from a route provider's fill: the solver, not the buyer, sent it. */
  routed?: boolean;
}

/** Verify a HyperCore hash against `session` (payTo, amount, createdAt, payer). */
export async function verifyHyperCorePayment(
  runtime: HyperCoreRuntime,
  session: CheckoutSession,
  txHash: string,
  options: HyperCoreVerifyOptions = {},
): Promise<OnChainVerification> {
  const result = await verifyHyperCoreTransfer(runtime.client, {
    txHash: normalizeTxHash("hypercore", txHash),
    payTo: hyperCorePayTo(session),
    expectedBase: toBaseUnits(session.amount.amount),
    notBefore: new Date(session.createdAt),
    ...(session.payerAddress && options.routed !== true ? { payer: session.payerAddress } : {}),
  });
  return fromHyperCoreVerification(result);
}
