/**
 * Treasury transfer intent: the validated, policy-approved description of a
 * USDC movement that the treasury engine produces and the API layer hands to
 * an executor (e.g. `@settlekit/circle-wallets` `createTransfer`).
 *
 * The intent is deliberately execution-agnostic — it carries the source wallet,
 * destination, amount, and provenance, but knows nothing about Circle. This
 * keeps the treasury package dependent only on `@settlekit/common` while still
 * driving a real on-chain transfer downstream.
 */
import type { Money } from "@settlekit/common";

/** A validated, policy-approved USDC transfer ready to execute. */
export interface TreasuryTransferIntent {
  /** Source treasury wallet (opaque id; e.g. a Circle wallet id). */
  sourceWalletId: string;
  /** Destination on-chain address. */
  destination: string;
  /** Exact amount to move. */
  amount: Money;
  /** Approver ids that satisfied the threshold, in approval order. */
  approvals: string[];
  /** Caller reference echoed onto the downstream transaction. */
  refId?: string;
  /** When the intent was finalized (ISO-8601). */
  createdAt: string;
}
