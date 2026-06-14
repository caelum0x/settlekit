import type { DeliveryActionRun } from "@settlekit/common";

export function markActionRolledBack(run: DeliveryActionRun): DeliveryActionRun {
  return { ...run, status: "rolled_back" };
}
