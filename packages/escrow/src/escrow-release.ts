import type { EscrowTask } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";

export function releaseEscrow(task: EscrowTask, txHash: string): EscrowTask {
  return { ...task, status: nextEscrowStatus(task.status, "release"), releaseTxHash: txHash };
}
