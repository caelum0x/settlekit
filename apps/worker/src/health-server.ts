/**
 * Minimal HTTP health + metrics server for the worker.
 *
 * The worker has no request API, but production orchestrators (k8s, ECS, load
 * balancers) still need a liveness/readiness target and a metrics scrape point.
 * This dependency-free `node:http` server exposes:
 *   - GET /health, /healthz  -> 200 liveness
 *   - GET /ready             -> 200 readiness (the scheduler is running)
 *   - GET /metrics           -> Prometheus text: scheduler throughput counters
 *
 * Port comes from `WORKER_HEALTH_PORT` (default 8788). Returns the server handle
 * so the caller can close it during graceful shutdown.
 */
import { createServer, type Server } from "node:http";
import type { Scheduler } from "./scheduler.js";
import type { Logger } from "./logger.js";

/** Render the worker's Prometheus metrics from the scheduler stats. */
function renderMetrics(scheduler: Scheduler): string {
  const s = scheduler.stats();
  const uptimeSeconds = Math.max(0, Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000));
  return [
    "# HELP settlekit_worker_up Worker liveness (always 1 while serving).",
    "# TYPE settlekit_worker_up gauge",
    "settlekit_worker_up 1",
    "# HELP settlekit_worker_uptime_seconds Seconds since the scheduler started.",
    "# TYPE settlekit_worker_uptime_seconds gauge",
    `settlekit_worker_uptime_seconds ${uptimeSeconds}`,
    "# HELP settlekit_worker_jobs Number of scheduled jobs.",
    "# TYPE settlekit_worker_jobs gauge",
    `settlekit_worker_jobs ${s.jobs}`,
    "# HELP settlekit_worker_ticks_total Total job ticks started.",
    "# TYPE settlekit_worker_ticks_total counter",
    `settlekit_worker_ticks_total ${s.ticksTotal}`,
    "# HELP settlekit_worker_ticks_skipped_total Ticks skipped (previous still running).",
    "# TYPE settlekit_worker_ticks_skipped_total counter",
    `settlekit_worker_ticks_skipped_total ${s.ticksSkipped}`,
    "# HELP settlekit_worker_ticks_errored_total Ticks that threw.",
    "# TYPE settlekit_worker_ticks_errored_total counter",
    `settlekit_worker_ticks_errored_total ${s.ticksErrored}`,
    "# HELP settlekit_worker_items_processed_total Items processed across all ticks.",
    "# TYPE settlekit_worker_items_processed_total counter",
    `settlekit_worker_items_processed_total ${s.itemsProcessed}`,
    "# HELP settlekit_worker_items_failed_total Items that failed across all ticks.",
    "# TYPE settlekit_worker_items_failed_total counter",
    `settlekit_worker_items_failed_total ${s.itemsFailed}`,
    "",
  ].join("\n");
}

/** Start the worker's health/metrics server. Returns the running server. */
export function startHealthServer(scheduler: Scheduler, logger: Logger): Server {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 8788);

  const server = createServer((req, res) => {
    const url = (req.url ?? "/").split("?")[0];
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "method_not_allowed", message: "GET only" } }));
      return;
    }
    if (url === "/health" || url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { status: "ok", service: "settlekit-worker" } }));
      return;
    }
    if (url === "/ready") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { ready: true, jobs: scheduler.stats().jobs } }));
      return;
    }
    if (url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(renderMetrics(scheduler));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "not_found", message: `No route for ${url}` } }));
  });

  server.listen(port, () => {
    logger.info("worker health server listening", { port });
  });
  return server;
}
