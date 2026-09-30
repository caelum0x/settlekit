/**
 * Seller webhook delivery log: each (event, endpoint) job records its
 * attempts (status code, error, time), when the next retry is due, and
 * whether it was delivered. The API reads it for the dashboard event log,
 * queues resends and test events, and the worker writes attempts as it
 * delivers. Endpoints track consecutive failures and are disabled after too
 * many in a row, so a dead URL stops consuming retries.
 *
 * Jobs live in `worker_webhook_jobs.metadata` (Postgres) or in memory.
 */
import { generateSecret, type WebhookEndpoint, type WebhookEvent } from "@settlekit/common";
import { desc, eq, type Database, workerWebhookJobs } from "@settlekit/database";
import { packDoc, unpackDoc, unpackDocs } from "./codec.js";

/** One HTTP delivery attempt. */
export interface WebhookAttempt {
  at: string;
  /** HTTP status (0 when the request failed before a response). */
  status: number;
  ok: boolean;
  error?: string;
}

/** A queued / delivered / failed delivery of one event to one endpoint. */
export interface WebhookDeliveryJob {
  id: string;
  /** Endpoint snapshot at enqueue time (the worker re-reads the live one). */
  endpoint: WebhookEndpoint;
  event: WebhookEvent;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  /** Newest last, capped at {@link HISTORY_LIMIT}. */
  history?: WebhookAttempt[];
  nextAttemptAt?: string;
  deliveredAt?: string;
  /** Queued by a merchant (resend or test) rather than by an event. */
  manual?: "resend" | "test";
  createdAt?: string;
}

export const HISTORY_LIMIT = 20;
/** Give up on a job after this many attempts (kept `failed` for manual resend). */
export const MAX_JOB_ATTEMPTS = 24;
/** Disable an endpoint after this many failed attempts in a row. */
export const DEFAULT_DISABLE_AFTER = 100;

/** Backoff before the next scheduled tick: 1m, 2m, 4m ... capped at 6h. */
export function nextRetryDelayMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
}

/** Apply a tick's attempts to a job (pure). */
export function recordJobAttempts(
  job: WebhookDeliveryJob,
  attempts: readonly WebhookAttempt[],
  now: Date,
): WebhookDeliveryJob {
  const delivered = attempts.some((a) => a.ok);
  const total = job.attempts + attempts.length;
  const history = [...(job.history ?? []), ...attempts].slice(-HISTORY_LIMIT);
  if (delivered) {
    const { nextAttemptAt: _drop, ...rest } = job;
    void _drop;
    return { ...rest, status: "delivered", attempts: total, history, deliveredAt: now.toISOString() };
  }
  return {
    ...job,
    status: "failed",
    attempts: total,
    history,
    ...(total < MAX_JOB_ATTEMPTS ? { nextAttemptAt: new Date(now.getTime() + nextRetryDelayMs(total)).toISOString() } : {}),
  };
}

/** Whether a job should be attempted at `now`. */
export function isJobDue(job: WebhookDeliveryJob, now: Date): boolean {
  if (job.status === "delivered" || job.attempts >= MAX_JOB_ATTEMPTS) return false;
  return job.nextAttemptAt === undefined || Date.parse(job.nextAttemptAt) <= now.getTime();
}

/** Update an endpoint's failure streak; disables it after `disableAfter` in a row. */
export function applyEndpointOutcome(
  endpoint: WebhookEndpoint,
  attempts: readonly WebhookAttempt[],
  now: Date,
  disableAfter: number = DEFAULT_DISABLE_AFTER,
): WebhookEndpoint {
  if (attempts.length === 0) return endpoint;
  const lastOk = attempts.map((a) => a.ok).lastIndexOf(true);
  const failuresAfter = attempts.length - 1 - lastOk;
  const streak = lastOk >= 0 ? failuresAfter : (endpoint.consecutiveFailures ?? 0) + attempts.length;
  if (streak >= disableAfter && endpoint.active) {
    return {
      ...endpoint,
      consecutiveFailures: streak,
      active: false,
      disabledAt: now.toISOString(),
      disabledReason: `${streak} failed deliveries in a row`,
    };
  }
  return { ...endpoint, consecutiveFailures: streak };
}

/** Rotate an endpoint's secret; the old one stays valid for `graceMs`. */
export function rotateEndpointSecret(
  endpoint: WebhookEndpoint,
  now: Date,
  graceMs: number,
  newSecret: string = generateSecret(),
): WebhookEndpoint {
  return {
    ...endpoint,
    signingSecret: newSecret,
    ...(graceMs > 0
      ? { previousSigningSecret: endpoint.signingSecret, previousSecretExpiresAt: new Date(now.getTime() + graceMs).toISOString() }
      : { previousSigningSecret: undefined, previousSecretExpiresAt: undefined }),
  };
}

/** Re-enable a disabled endpoint (resets the failure streak). */
export function enableEndpoint(endpoint: WebhookEndpoint): WebhookEndpoint {
  const { disabledAt: _a, disabledReason: _b, ...rest } = endpoint;
  void _a;
  void _b;
  return { ...rest, active: true, consecutiveFailures: 0 };
}

/** A new manual job (resend / test) for one endpoint; unique per request. */
export function manualJob(
  event: WebhookEvent,
  endpoint: WebhookEndpoint,
  kind: "resend" | "test",
  now: Date,
): WebhookDeliveryJob {
  return {
    id: `whj_${kind}_${generateSecret(9)}`,
    endpoint,
    event,
    status: "pending",
    attempts: 0,
    manual: kind,
    createdAt: now.toISOString(),
  };
}

/** Buyer/merchant-safe view of a job: never includes signing secrets. */
export interface WebhookDeliveryView {
  id: string;
  eventId: string;
  eventType: string;
  endpointId: string;
  url: string;
  status: WebhookDeliveryJob["status"];
  attempts: number;
  lastStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  manual: WebhookDeliveryJob["manual"] | null;
  history: WebhookAttempt[];
}

export function deliveryView(job: WebhookDeliveryJob): WebhookDeliveryView {
  const last = job.history?.at(-1);
  return {
    id: job.id,
    eventId: job.event.id,
    eventType: job.event.type,
    endpointId: job.endpoint.id,
    url: job.endpoint.url,
    status: job.status,
    attempts: job.attempts,
    lastStatus: last?.status ?? null,
    lastError: last?.error ?? null,
    lastAttemptAt: last?.at ?? null,
    nextAttemptAt: job.nextAttemptAt ?? null,
    deliveredAt: job.deliveredAt ?? null,
    manual: job.manual ?? null,
    history: [...(job.history ?? [])],
  };
}

/** Storage for delivery jobs. */
export interface WebhookJobStore {
  save(job: WebhookDeliveryJob): Promise<WebhookDeliveryJob>;
  findById(id: string): Promise<WebhookDeliveryJob | null>;
  /** Jobs of one organization, newest first. */
  listByOrganization(organizationId: string, limit?: number): Promise<WebhookDeliveryJob[]>;
}

export class InMemoryWebhookJobStore implements WebhookJobStore {
  private readonly byId = new Map<string, WebhookDeliveryJob>();

  async save(job: WebhookDeliveryJob): Promise<WebhookDeliveryJob> {
    this.byId.set(job.id, structuredClone(job));
    return job;
  }

  async findById(id: string): Promise<WebhookDeliveryJob | null> {
    const job = this.byId.get(id);
    return job ? structuredClone(job) : null;
  }

  async listByOrganization(organizationId: string, limit = 200): Promise<WebhookDeliveryJob[]> {
    return [...this.byId.values()]
      .filter((j) => j.event.organizationId === organizationId)
      .sort((a, b) => (b.createdAt ?? b.event.createdAt).localeCompare(a.createdAt ?? a.event.createdAt))
      .slice(0, limit)
      .map((j) => structuredClone(j));
  }
}

/** Postgres store over `worker_webhook_jobs` (the worker's delivery queue). */
export class PgWebhookJobStore implements WebhookJobStore {
  constructor(private readonly db: Database) {}

  async save(job: WebhookDeliveryJob): Promise<WebhookDeliveryJob> {
    const projection = { status: job.status, metadata: packDoc(job) };
    await this.db
      .insert(workerWebhookJobs)
      .values({ id: job.id, ...projection })
      .onConflictDoUpdate({ target: workerWebhookJobs.id, set: projection });
    return job;
  }

  async findById(id: string): Promise<WebhookDeliveryJob | null> {
    const rows = await this.db
      .select({ metadata: workerWebhookJobs.metadata })
      .from(workerWebhookJobs)
      .where(eq(workerWebhookJobs.id, id))
      .limit(1);
    return unpackDoc<WebhookDeliveryJob>(rows[0]);
  }

  async listByOrganization(organizationId: string, limit = 200): Promise<WebhookDeliveryJob[]> {
    // Newest rows first; the org filter runs on the unpacked documents.
    const rows = await this.db
      .select({ metadata: workerWebhookJobs.metadata })
      .from(workerWebhookJobs)
      .orderBy(desc(workerWebhookJobs.createdAt))
      .limit(5_000);
    return unpackDocs<WebhookDeliveryJob>(rows)
      .filter((j) => j.event.organizationId === organizationId)
      .slice(0, limit);
  }
}
