import { generateId, type DeliveryActionRun, type DeliveryRun } from "@settlekit/common";
import type { RunDeliveryPlanInput } from "./types.js";

export async function runDeliveryPlan(input: RunDeliveryPlanInput): Promise<DeliveryRun> {
  const now = input.now ?? new Date();
  const actionRuns: DeliveryActionRun[] = [];

  for (const action of input.plan.actions) {
    const handler = input.handlers[action.type];
    const actionRun: DeliveryActionRun = {
      id: generateId("deliveryAction"),
      action,
      status: "running",
      attempts: 1,
    };
    actionRuns.push(actionRun);

    try {
      if (!handler) throw new Error(`No delivery handler registered for ${action.type}`);
      const output = await handler(action, input.context);
      actionRun.status = "succeeded";
      if (output) actionRun.output = output;
    } catch (error) {
      actionRun.status = "failed";
      actionRun.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const failures = actionRuns.filter((run) => run.status === "failed").length;
  return {
    id: generateId("deliveryRun"),
    organizationId: input.context.organizationId,
    paymentId: input.context.paymentId,
    customerId: input.context.customerId,
    deliveryPlanId: input.plan.id,
    status: failures === 0 ? "succeeded" : failures === actionRuns.length ? "failed" : "partially_failed",
    actionRuns,
    createdAt: now.toISOString(),
    completedAt: new Date().toISOString(),
  };
}
