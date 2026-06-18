/**
 * Adapt a production {@link SettlementProvider} (Gateway / Circle / local) into
 * an x402 {@link Settler}. This is how the paying agent settles real x402
 * challenges on Arc: the challenge's nonce is the idempotency reference, so a
 * retried payment never double-settles.
 */

import type { SettlementProvider } from "@settlekit/settlement-core";
import type { PaymentProof } from "@settlekit/x402";
import type { Settler, SettleRequest } from "./types.js";

/** Wrap a settlement provider as an x402 settler. */
export function createProviderSettler(provider: SettlementProvider): Settler {
  return {
    async settle(request: SettleRequest): Promise<PaymentProof> {
      const { requirements, from } = request;
      const receipt = await provider.settle({
        reference: requirements.nonce,
        to: requirements.payTo,
        amountUsdc: requirements.amount,
        network: requirements.network,
        memo: `x402:${requirements.productId}`,
      });
      return {
        txHash: receipt.txHash ?? receipt.id,
        from,
        amount: requirements.amount,
        network: requirements.network,
        nonce: requirements.nonce,
      };
    },
  };
}
