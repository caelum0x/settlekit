/**
 * The {@link SettlementVerifier} for `hypercore` (API registry / worker):
 * verifies the proof's hash against the payee's ledger with the session's
 * payTo, amount, notBefore and payer bindings.
 */

import type { SettlementVerifier } from "@settlekit/chains";
import { toBaseUnits } from "@settlekit/common";
import { verifyHyperCoreTransfer, type HyperCoreLedgerSource } from "./verify.js";

export function createHyperCoreSettlementVerifier(source: HyperCoreLedgerSource): SettlementVerifier {
  return async (proof, requirements) => {
    if (proof.network !== "hypercore" || requirements.network !== "hypercore") {
      return { ok: false, reason: `Unsupported network: ${proof.network}` };
    }
    if (requirements.asset !== "USDC") {
      return { ok: false, reason: `Unsupported settlement asset on hypercore: ${requirements.asset}` };
    }
    let expectedBase: bigint;
    try {
      expectedBase = toBaseUnits(requirements.amount);
    } catch {
      return { ok: false, reason: `Invalid amount: ${requirements.amount}` };
    }
    const notBefore = requirements.notBefore ? new Date(requirements.notBefore) : new Date(0);
    const result = await verifyHyperCoreTransfer(source, {
      txHash: proof.txHash,
      payTo: requirements.payTo,
      expectedBase,
      notBefore: Number.isNaN(notBefore.getTime()) ? new Date(0) : notBefore,
      ...(requirements.payer ? { payer: requirements.payer } : {}),
    });
    return result.ok
      ? { ok: true, confirmations: 1 }
      : { ok: false, reason: result.reason, retryable: result.retryable, confirmations: 0 };
  };
}
