import type { DeliveryActionRun } from "@settlekit/common";
import type { DeliveryContext, DeliveryHandlerRegistry } from "./types.js";

export async function retryFailedActions(
  actionRuns: DeliveryActionRun[],
  context: DeliveryContext,
  handlers: DeliveryHandlerRegistry,
): Promise<DeliveryActionRun[]> {
  const next: DeliveryActionRun[] = [];
  for (const run of actionRuns) {
    if (run.status !== "failed") {
      next.push(run);
      continue;
    }
    const retried: DeliveryActionRun = { ...run, attempts: run.attempts + 1, status: "running", lastError: undefined };
    try {
      const output = await handlers[run.action.type]?.(run.action, context);
      retried.status = "succeeded";
      if (output) retried.output = output;
    } catch (error) {
      retried.status = "failed";
      retried.lastError = error instanceof Error ? error.message : String(error);
    }
    next.push(retried);
  }
  return next;
}
