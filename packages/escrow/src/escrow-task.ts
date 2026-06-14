import { generateId, type EscrowTask } from "@settlekit/common";

export function createEscrowTask(input: Omit<EscrowTask, "id" | "status" | "createdAt">, now = new Date()): EscrowTask {
  return { ...input, id: generateId("escrowTask"), status: "created", createdAt: now.toISOString() };
}
