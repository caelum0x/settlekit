/**
 * Interval-based job runner with graceful shutdown.
 *
 * Each registered job runs on its own fixed interval. Ticks for a given job
 * never overlap: if a tick is still running when the timer fires, the new tick
 * is skipped and a warning is logged. On SIGINT/SIGTERM the scheduler stops
 * scheduling further ticks, waits for any in-flight ticks to settle (up to a
 * drain deadline), and resolves — letting the process exit cleanly.
 */

import { errorMessage, type Logger } from "./logger.js";
import type { Job, JobContext } from "./jobs/types.js";

/** A job paired with the cadence at which the scheduler should run it. */
export interface ScheduledJob {
  job: Job;
  intervalMs: number;
}

export interface SchedulerOptions {
  /** Max time (ms) to wait for in-flight ticks to finish on shutdown. */
  drainTimeoutMs?: number;
  /** Run every job once immediately on start, before the first interval. */
  runOnStart?: boolean;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

export class Scheduler {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly drainTimeoutMs: number;
  private readonly runOnStart: boolean;
  private stopping = false;

  constructor(
    private readonly scheduled: readonly ScheduledJob[],
    private readonly ctx: JobContext,
    private readonly logger: Logger,
    options: SchedulerOptions = {},
  ) {
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.runOnStart = options.runOnStart ?? true;
  }

  /** Begin scheduling every job. Idempotent ticks are guaranteed per job. */
  start(): void {
    for (const { job, intervalMs } of this.scheduled) {
      if (this.runOnStart) void this.tick(job);
      const timer = setInterval(() => void this.tick(job), intervalMs);
      // Do not keep the event loop alive solely for the timer.
      if (typeof timer.unref === "function") timer.unref();
      this.timers.set(job.name, timer);
      this.logger.info("job scheduled", { job: job.name, intervalMs });
    }
  }

  /** Run a single tick of `job`, skipping if a previous tick is still running. */
  private async tick(job: Job): Promise<void> {
    if (this.stopping) return;
    if (this.inFlight.has(job.name)) {
      this.logger.warn("job tick skipped; previous tick still running", { job: job.name });
      return;
    }

    const started = Date.now();
    const run = (async () => {
      try {
        const result = await job.run(this.ctx);
        this.logger.info("job tick complete", {
          job: job.name,
          processed: result.processed,
          failed: result.failed,
          durationMs: Date.now() - started,
        });
      } catch (error) {
        this.logger.error("job tick threw", { job: job.name, error: errorMessage(error) });
      }
    })();

    this.inFlight.set(job.name, run);
    try {
      await run;
    } finally {
      this.inFlight.delete(job.name);
    }
  }

  /**
   * Stop scheduling and wait for in-flight ticks to settle (bounded by the drain
   * timeout). Safe to call more than once.
   */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();

    const pending = [...this.inFlight.values()];
    if (pending.length === 0) {
      this.logger.info("scheduler stopped; no in-flight ticks");
      return;
    }

    this.logger.info("scheduler draining in-flight ticks", { count: pending.length });
    const drain = Promise.allSettled(pending);
    const timeout = new Promise<void>((resolve) => {
      const t = setTimeout(resolve, this.drainTimeoutMs);
      if (typeof t.unref === "function") t.unref();
    });
    await Promise.race([drain, timeout]);
    this.logger.info("scheduler stopped");
  }

  /**
   * Wire SIGINT/SIGTERM to a graceful {@link stop}. Returns a promise that
   * resolves once a shutdown signal has been handled and draining completes.
   */
  installSignalHandlers(signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"]): Promise<void> {
    return new Promise<void>((resolve) => {
      const handle = (signal: NodeJS.Signals) => {
        this.logger.info("shutdown signal received", { signal });
        void this.stop().then(resolve);
      };
      for (const signal of signals) process.once(signal, handle);
    });
  }
}
