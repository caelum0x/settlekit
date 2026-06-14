import type { EscrowTask } from "@settlekit/common";
import { nextEscrowStatus } from "./escrow-status.js";

export function markEscrowFunded(task: EscrowTask, txHash: string): EscrowTask {
  return { ...task, status: nextEscrowStatus(task.status, "fund"), fundingTxHash: txHash };
}
