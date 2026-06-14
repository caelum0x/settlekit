import type { EscrowStatus } from "@settlekit/common";

export type EscrowTransition =
  | "fund"
  | "assign"
  | "submit"
  | "approve"
  | "release"
  | "refund"
  | "dispute";

export interface EscrowStateChange {
  from: EscrowStatus;
  to: EscrowStatus;
  transition: EscrowTransition;
}
