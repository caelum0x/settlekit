/**
 * Job barrel: the real, runnable jobs plus the static job catalog the scheduler
 * and ops tooling reference by name.
 */

export type { Job, JobContext, JobResult } from "./types.js";
export { deliveryRunnerJob } from "./delivery-runner-job.js";
export { paymentConfirmJob } from "./payment-confirm-job.js";
export { accessSyncJob } from "./access-sync-job.js";
export { renewalSweepJob } from "./renewal-sweep-job.js";
export { webhookRetryJob } from "./webhook-retry-job.js";

import type { Job } from "./types.js";
import { deliveryRunnerJob } from "./delivery-runner-job.js";
import { paymentConfirmJob } from "./payment-confirm-job.js";
import { accessSyncJob } from "./access-sync-job.js";
import { renewalSweepJob } from "./renewal-sweep-job.js";
import { webhookRetryJob } from "./webhook-retry-job.js";

/** Stable list of the worker's primary scheduled jobs (plan §17). */
export const workerJobs = [
  "delivery-runner",
  "payment-confirm",
  "access-sync",
  "renewal-sweep",
  "webhook-retry",
] as const;

export type WorkerJobName = (typeof workerJobs)[number];

/** Every runnable job, in catalog order. */
export function allJobs(): Job[] {
  return [deliveryRunnerJob, paymentConfirmJob, accessSyncJob, renewalSweepJob, webhookRetryJob];
}
