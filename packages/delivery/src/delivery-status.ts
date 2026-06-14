import type { DeliveryRun } from "@settlekit/common";

export function deliveryRunSucceeded(run: DeliveryRun): boolean {
  return run.status === "succeeded";
}
