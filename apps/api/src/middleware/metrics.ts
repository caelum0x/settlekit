/**
 * Prometheus-style metrics for the API — a dependency-free registry + middleware
 * + a `/metrics` exposition endpoint. Tracks request counts (by method + status
 * class), in-flight requests, total errors, and a request-duration histogram.
 *
 * Render format is the Prometheus text exposition format (v0.0.4), so it scrapes
 * cleanly with Prometheus / Grafana Agent / any OpenMetrics collector. Counters
 * are process-local; in a horizontally-scaled fleet each instance exposes its
 * own — aggregate at the collector.
 */
import type { MiddlewareHandler } from "hono";

/** Histogram buckets (seconds) for request duration. */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** A minimal in-process metrics registry. */
class MetricsRegistry {
  /** `${method}|${statusClass}` -> count. */
  private readonly requestsTotal = new Map<string, number>();
  private inFlight = 0;
  private errorsTotal = 0;
  private readonly durationBucketCounts = new Array<number>(DURATION_BUCKETS.length + 1).fill(0);
  private durationSum = 0;
  private durationCount = 0;

  /** Record the start of a request. */
  startRequest(): void {
    this.inFlight += 1;
  }

  /** Record the completion of a request. */
  endRequest(method: string, status: number, durationSeconds: number): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const statusClass = `${Math.floor(status / 100)}xx`;
    const key = `${method}|${statusClass}`;
    this.requestsTotal.set(key, (this.requestsTotal.get(key) ?? 0) + 1);
    if (status >= 500) this.errorsTotal += 1;

    // Histogram: increment every bucket whose upper bound >= the observation.
    let placed = false;
    for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
      if (durationSeconds <= (DURATION_BUCKETS[i] as number)) {
        this.durationBucketCounts[i] = (this.durationBucketCounts[i] ?? 0) + 1;
        placed = true;
      }
    }
    // The +Inf bucket always counts.
    this.durationBucketCounts[DURATION_BUCKETS.length] =
      (this.durationBucketCounts[DURATION_BUCKETS.length] ?? 0) + 1;
    void placed;
    this.durationSum += durationSeconds;
    this.durationCount += 1;
  }

  /** Render the Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];

    lines.push("# HELP settlekit_http_requests_total Total HTTP requests by method and status class.");
    lines.push("# TYPE settlekit_http_requests_total counter");
    for (const [key, count] of this.requestsTotal) {
      const [method, statusClass] = key.split("|");
      lines.push(`settlekit_http_requests_total{method="${method}",status="${statusClass}"} ${count}`);
    }

    lines.push("# HELP settlekit_http_requests_in_flight In-flight HTTP requests.");
    lines.push("# TYPE settlekit_http_requests_in_flight gauge");
    lines.push(`settlekit_http_requests_in_flight ${this.inFlight}`);

    lines.push("# HELP settlekit_http_errors_total Total 5xx responses.");
    lines.push("# TYPE settlekit_http_errors_total counter");
    lines.push(`settlekit_http_errors_total ${this.errorsTotal}`);

    lines.push("# HELP settlekit_http_request_duration_seconds Request duration histogram.");
    lines.push("# TYPE settlekit_http_request_duration_seconds histogram");
    // Buckets are cumulative in Prometheus; our per-bucket counts already are
    // (every observation increments all buckets >= its value), so emit directly.
    let cumulative = 0;
    for (let i = 0; i < DURATION_BUCKETS.length; i += 1) {
      cumulative = this.durationBucketCounts[i] as number;
      lines.push(
        `settlekit_http_request_duration_seconds_bucket{le="${DURATION_BUCKETS[i]}"} ${cumulative}`,
      );
    }
    lines.push(
      `settlekit_http_request_duration_seconds_bucket{le="+Inf"} ${this.durationCount}`,
    );
    lines.push(`settlekit_http_request_duration_seconds_sum ${this.durationSum.toFixed(6)}`);
    lines.push(`settlekit_http_request_duration_seconds_count ${this.durationCount}`);

    return `${lines.join("\n")}\n`;
  }
}

/** The process-wide registry shared by the middleware and the `/metrics` route. */
export const metricsRegistry = new MetricsRegistry();

/** Middleware that records request count, in-flight, errors, and duration. */
export function metricsMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // Don't meter the scrape endpoint itself.
    if (c.req.path === "/metrics") return next();
    const start = performance.now();
    metricsRegistry.startRequest();
    try {
      await next();
    } finally {
      metricsRegistry.endRequest(c.req.method, c.res.status, (performance.now() - start) / 1000);
    }
  };
}
