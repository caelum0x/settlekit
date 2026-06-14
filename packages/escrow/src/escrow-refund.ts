import type { EscrowTask } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";

export function refundEscrow(task: EscrowTask): EscrowTask {
  return { ...task, status: nextEscrowStatus(task.status, "refund") };
}
