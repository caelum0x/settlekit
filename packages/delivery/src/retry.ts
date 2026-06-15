/**
 * Re-run only the failed actions of an existing {@link DeliveryRun}.
 *
 * Used to recover a `partially_failed`/`failed` run without re-executing the
 * actions that already succeeded (which would, e.g., re-issue license keys or
 * re-invite collaborators). Failed actions are reset to `pending` and the run is
 * handed back to {@link DeliveryRunner.executePending}, which preserves the
 * existing succeeded/rolled_back actions while retrying the rest.
 */

import type { DeliveryActionRun, DeliveryRun } from "@settlekit/common";
import { SettleKitError } from "@settlekit/common";
import { DeliveryRunner } from "./runner.js";
import type { DeliveryContext } from "./types.js";

/** Reset a single failed action run back to a clean pending state (immutably). */
function resetFailed(actionRun: DeliveryActionRun): DeliveryActionRun {
  if (actionRun.status !== "failed") return actionRun;
  // Preserve the accumulated attempt count for observability; clear the stale
  // error and any partial output so a fresh execution starts clean.
  const { lastError: _lastError, output: _output, ...rest } = actionRun;
  return { ...rest, status: "pending" };
}

/**
 * Re-run only the failed actions of `run` using `runner`. Returns a NEW run
 * snapshot. Throws if the run has no failed actions to retry.
 */
export async function retryRun(
  run: DeliveryRun,
  runner: DeliveryRunner,
  ctx: DeliveryContext,
): Promise<DeliveryRun> {
  const failedCount = run.actionRuns.filter((ar) => ar.status === "failed").length;
  if (failedCount === 0) {
    throw new SettleKitError({
      code: "validation_error",
      message: `Delivery run ${run.id} has no failed actions to retry`,
      details: { deliveryRunId: run.id, status: run.status },
    });
  }

  const actionRuns = run.actionRuns.map(resetFailed);
  const prepared: DeliveryRun = {
    ...run,
    status: "running",
    actionRuns,
    // Clear the prior terminal timestamp; executePending sets a new one.
    completedAt: undefined,
  };

  return runner.executePending(prepared, ctx);
}
