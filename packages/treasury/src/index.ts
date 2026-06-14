import { compareMoney, type Money } from "@settlekit/common";

export interface TreasuryPolicy {
  requiredApprovals: number;
  dailyLimit: Money;
}

export interface TreasuryTransfer {
  amount: Money;
  approvals: string[];
}

export function transferMeetsPolicy(transfer: TreasuryTransfer, policy: TreasuryPolicy): boolean {
  return transfer.approvals.length >= policy.requiredApprovals && compareMoney(transfer.amount, policy.dailyLimit) !== 1;
}

export function addTreasuryApproval(transfer: TreasuryTransfer, approverId: string): TreasuryTransfer {
  return transfer.approvals.includes(approverId) ? transfer : { ...transfer, approvals: [...transfer.approvals, approverId] };
}
