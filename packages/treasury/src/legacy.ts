/**
 * Backward-compatible helpers retained from the original treasury API.
 *
 * These remain supported and are now thin wrappers over the policy engine in
 * `./policy.ts`. New code should prefer `evaluate` / `toTransferIntent`, which
 * also enforce daily-limit windowing and the destination allowlist.
 */
import { compareMoney } from "@settlekit/common";
import type { Money } from "@settlekit/common";
import type { TreasuryPolicy } from "./policy.js";
import { distinctApprovals } from "./policy.js";

/** A transfer accumulating approvals before release (legacy shape). */
export interface TreasuryTransfer {
  amount: Money;
  approvals: string[];
}

/**
 * True when a transfer clears the approval threshold and is at or below the
 * daily limit. Does not window prior spend or check the allowlist — use
 * `evaluate` for full custody enforcement.
 */
export function transferMeetsPolicy(transfer: TreasuryTransfer, policy: TreasuryPolicy): boolean {
  return (
    distinctApprovals(transfer.approvals).length >= policy.requiredApprovals &&
    compareMoney(transfer.amount, policy.dailyLimit) !== 1
  );
}

/** Add an approver immutably, de-duplicating repeated approvals. */
export function addTreasuryApproval(transfer: TreasuryTransfer, approverId: string): TreasuryTransfer {
  return transfer.approvals.includes(approverId)
    ? transfer
    : { ...transfer, approvals: [...transfer.approvals, approverId] };
}
