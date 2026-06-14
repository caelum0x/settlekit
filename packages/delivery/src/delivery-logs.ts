import { generateId, type DeliveryLog } from "@settlekit/common";

export function createDeliveryLog(input: Omit<DeliveryLog, "id" | "createdAt">, now = new Date()): DeliveryLog {
  return { ...input, id: generateId("deliveryAction"), createdAt: now.toISOString() };
}
