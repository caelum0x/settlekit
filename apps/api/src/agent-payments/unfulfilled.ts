/**
 * A payment settled on-chain but fulfilment then failed unexpectedly (not a
 * domain error such as a reused tx hash). Money has moved, so the settlement
 * must never be lost silently: emit a structured error line for
 * reconciliation and hand the agent the transaction so it can prove payment.
 */
import type { Context } from "hono";
import { SettleKitError } from "@settlekit/common";
import { error } from "../http/respond.js";

export interface SettlementRef {
  rail: "x402" | "mpp";
  network: string;
  txHash: string;
  productId: string;
  payer?: string;
}

/** Map a fulfilment error to a response, logging settled-but-unfulfilled payments. */
export function fulfilmentError(c: Context, err: unknown, settlement: SettlementRef): Response {
  if (SettleKitError.is(err)) return error(c, err);
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    `${JSON.stringify({ ts: new Date().toISOString(), app: "api", level: "error", msg: "agent purchase settled but not fulfilled", ...settlement, error: message })}\n`,
  );
  return c.json(
    {
      error: {
        code: "fulfilment_failed",
        message: "payment settled but fulfilment failed; it has been logged for reconciliation",
        details: { ...settlement },
      },
    },
    500,
  );
}
