import { generateId, type DeliveryAction, type DeliveryPlan } from "@settlekit/common";

export function createDeliveryPlan(input: Omit<DeliveryPlan, "id" | "createdAt">, now = new Date()): DeliveryPlan {
  return { ...input, id: generateId("deliveryPlan"), createdAt: now.toISOString() };
}

export function appendDeliveryAction(plan: DeliveryPlan, action: DeliveryAction): DeliveryPlan {
  return { ...plan, actions: [...plan.actions, action] };
}
