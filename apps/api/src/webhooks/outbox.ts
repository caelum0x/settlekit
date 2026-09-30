/**
 * Seller webhooks from the API. Postgres mode uses the shared outbox (events
 * + worker_webhook_jobs, delivered and retried by the worker). In-memory mode
 * (no DATABASE_URL, local dev) saves the event and delivers it in-process with
 * a short signed retry, so a developer still receives webhooks.
 */
import type { WebhookEndpoint, WebhookEvent } from "@settlekit/common";
import {
  InMemoryWebhookJobStore,
  PgWebhookJobStore,
  PgWebhookOutbox,
  manualJob,
  recordJobAttempts,
  webhookJobId,
  type WebhookAttempt,
  type WebhookDeliveryJob,
  type WebhookJobStore,
  buildOutboxEvent,
  emitWebhookSafely,
  subscribedEndpoints,
  type EntityStore,
  type WebhookEmitInput,
  type WebhookEmitResult,
  type WebhookOutbox,
} from "@settlekit/persistence";
import type { Database } from "@settlekit/database";
import { deliverWithRetry } from "@settlekit/webhooks";

const IN_PROCESS_SCHEDULE = [0, 2, 10] as const;

/** Deliver a job in this process and record its attempts (no-database mode). */
export async function deliverInProcess(
  jobs: WebhookJobStore,
  job: WebhookDeliveryJob,
  schedule: readonly number[] = IN_PROCESS_SCHEDULE,
): Promise<WebhookDeliveryJob> {
  let attempts: WebhookAttempt[];
  try {
    const outcome = await deliverWithRetry({ endpoint: job.endpoint, event: job.event, schedule });
    attempts = outcome.attempts.map((a) => ({
      at: new Date(a.at).toISOString(),
      status: a.result.status,
      ok: a.result.ok,
      ...(a.result.ok ? {} : { error: a.result.error ?? `HTTP ${a.result.status}` }),
    }));
  } catch (error) {
    attempts = [{ at: new Date().toISOString(), status: 0, ok: false, error: error instanceof Error ? error.message : String(error) }];
  }
  return jobs.save(recordJobAttempts(job, attempts, new Date()));
}

export class InProcessWebhookOutbox implements WebhookOutbox {
  constructor(
    private readonly endpoints: EntityStore<WebhookEndpoint>,
    private readonly events: EntityStore<WebhookEvent>,
    private readonly jobs: WebhookJobStore = new InMemoryWebhookJobStore(),
  ) {}

  async enqueue(input: WebhookEmitInput): Promise<WebhookEmitResult> {
    const event = buildOutboxEvent(input);
    if (await this.events.findById(event.id)) return { eventId: event.id, queued: 0, duplicate: true };
    await this.events.save(event);
    const targets = subscribedEndpoints(await this.endpoints.list(), input.organizationId, input.type);
    for (const endpoint of targets) {
      const job: WebhookDeliveryJob = {
        id: webhookJobId(event.id, endpoint.id),
        endpoint,
        event,
        status: "pending",
        attempts: 0,
        createdAt: event.createdAt,
      };
      await this.jobs.save(job);
      void deliverInProcess(this.jobs, job).catch((error: unknown) => {
        console.warn(`[webhooks] delivery to ${endpoint.url} failed:`, error instanceof Error ? error.message : error);
      });
    }
    return { eventId: event.id, queued: targets.length, duplicate: false };
  }
}

/** The delivery log store: the worker's queue table, or memory without a database. */
export function createWebhookJobStore(db: Database | null): WebhookJobStore {
  return db ? new PgWebhookJobStore(db) : new InMemoryWebhookJobStore();
}

export function createWebhookOutbox(
  db: Database | null,
  endpoints: EntityStore<WebhookEndpoint>,
  events: EntityStore<WebhookEvent>,
  jobs: WebhookJobStore = createWebhookJobStore(db),
): WebhookOutbox {
  return db ? new PgWebhookOutbox(db) : new InProcessWebhookOutbox(endpoints, events, jobs);
}

/**
 * Queue a merchant-requested delivery (resend or test) to one endpoint. With
 * a database the worker delivers it on its next tick; without one it is
 * delivered right away (one attempt) and the result is returned.
 */
export async function queueManualDelivery(
  db: Database | null,
  jobs: WebhookJobStore,
  event: WebhookEvent,
  endpoint: WebhookEndpoint,
  kind: "resend" | "test",
): Promise<WebhookDeliveryJob> {
  const job = await jobs.save(manualJob(event, endpoint, kind, new Date()));
  return db ? job : deliverInProcess(jobs, job, [0]);
}

/** Queue a seller webhook; never throws (a webhook must not undo money movement). */
export function emitWebhook(outbox: WebhookOutbox, input: WebhookEmitInput): Promise<void> {
  return emitWebhookSafely(outbox, input);
}
