/**
 * On-chain payment verification for the hosted checkout.
 *
 * When Arc settlement is configured (ARC_RPC_URL + ARC_USDC_ADDRESS present),
 * a submitted transaction hash is verified against the chain with the REAL
 * `@settlekit/arc` client: the transaction must have transferred at least the
 * invoiced amount of USDC to the session's `payToAddress` and reached the
 * configured minimum confirmations before the payment is accepted. This closes
 * the trust gap where any well-formed hash would otherwise settle a session.
 *
 * When Arc is NOT configured (the standalone demo deployment with no RPC), this
 * returns `null` and the caller falls back to recording the payment at one
 * confirmation — the same posture as the API's null `arcVerifier`.
 */
import { createArcClient, type Hex } from "@settlekit/arc";
import type { Money } from "@settlekit/common";

/** Resolved Arc settlement configuration from the environment. */
interface ArcVerifyConfig {
  rpcUrl: string;
  usdcAddress: Hex;
  chainId: number;
  minConfirmations: number;
}

/** Read Arc settlement config from env, or `null` when it is not configured. */
function loadArcConfig(): ArcVerifyConfig | null {
  const rpcUrl = process.env.ARC_RPC_URL?.trim();
  const usdcAddress = process.env.ARC_USDC_ADDRESS?.trim();
  if (!rpcUrl || !usdcAddress) return null;
  const chainId = Number(process.env.ARC_CHAIN_ID ?? "1");
  const minConfirmations = Number(process.env.ARC_MIN_CONFIRMATIONS ?? "3");
  return {
    rpcUrl,
    usdcAddress: usdcAddress as Hex,
    chainId: Number.isFinite(chainId) && chainId > 0 ? chainId : 1,
    minConfirmations: Number.isInteger(minConfirmations) && minConfirmations > 0 ? minConfirmations : 3,
  };
}

/** Outcome of an on-chain verification attempt. */
export interface OnChainVerification {
  ok: boolean;
  /** Confirmations observed on-chain (0 when no matching transfer was found). */
  confirmations: number;
  /** Minimum confirmations required by configuration. */
  minConfirmations: number;
  /** Why verification failed, when `ok` is false. */
  reason?: string;
}

/** A well-formed Arc transaction hash (0x + 64 hex). */
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Verify a USDC transfer for a checkout payment. Returns `null` when Arc is not
 * configured (caller uses the demo fallback); otherwise returns the verification
 * outcome with the real observed confirmation count.
 */
export async function verifyOnChainPayment(input: {
  txHash: string;
  payTo: string;
  amount: Money;
}): Promise<OnChainVerification | null> {
  const config = loadArcConfig();
  if (!config) return null;

  if (!TX_HASH_RE.test(input.txHash)) {
    return { ok: false, confirmations: 0, minConfirmations: config.minConfirmations, reason: "Malformed transaction hash" };
  }

  const arc = createArcClient({
    rpcUrl: config.rpcUrl,
    usdcAddress: config.usdcAddress,
    chainId: config.chainId,
  });

  const result = await arc.verifyUsdcTransfer({
    txHash: input.txHash as Hex,
    to: input.payTo as Hex,
    minAmount: input.amount,
  });

  if (!result.confirmed) {
    return {
      ok: false,
      confirmations: result.confirmations,
      minConfirmations: config.minConfirmations,
      reason: "No matching USDC transfer found on-chain",
    };
  }
  if (result.confirmations < config.minConfirmations) {
    return {
      ok: false,
      confirmations: result.confirmations,
      minConfirmations: config.minConfirmations,
      reason: `Insufficient confirmations: ${result.confirmations} < ${config.minConfirmations}`,
    };
  }
  return { ok: true, confirmations: result.confirmations, minConfirmations: config.minConfirmations };
}
