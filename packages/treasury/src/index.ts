export type { TreasuryTransferIntent } from "./intent.js";

export {
  evaluate,
  toTransferIntent,
  recordSpend,
  spentInDay,
  dayKey,
  distinctApprovals,
  TreasuryPolicyError,
} from "./policy.js";
export type {
  TreasuryPolicy,
  TreasuryState,
  SpendEntry,
  TransferRequest,
  EvaluationResult,
  DenyReason,
} from "./policy.js";

export { transferMeetsPolicy, addTreasuryApproval } from "./legacy.js";
export type { TreasuryTransfer } from "./legacy.js";
