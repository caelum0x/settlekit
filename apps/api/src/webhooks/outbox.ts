/**
 * Seller webhooks from the API. Postgres mode uses the shared outbox (events
 * + worker_webhook_jobs, delivered and retried by the worker). In-memory mode
 * (no DATABASE_URL, local dev) saves the event and delivers it in-process with
 * a short signed retry, so a developer still receives webhooks.
 */
import type { WebhookEndpoint, WebhookEvent } from "@settlekit/common";
import {
  PgWebhookOutbox,
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

export class InProcessWebhookOutbox implements WebhookOutbox {
  constructor(
    private readonly endpoints: EntityStore<WebhookEndpoint>,
    private readonly events: EntityStore<WebhookEvent>,
  ) {}

  async enqueue(input: WebhookEmitInput): Promise<WebhookEmitResult> {
    const event = buildOutboxEvent(input);
    if (await this.events.findById(event.id)) return { eventId: event.id, queued: 0, duplicate: true };
    await this.events.save(event);
    const targets = subscribedEndpoints(await this.endpoints.list(), input.organizationId, input.type);
    for (const endpoint of targets) {
      void deliverWithRetry({ endpoint, event, schedule: IN_PROCESS_SCHEDULE }).catch((error: unknown) => {
        console.warn(`[webhooks] delivery to ${endpoint.url} failed:`, error instanceof Error ? error.message : error);
      });
    }
    return { eventId: event.id, queued: targets.length, duplicate: false };
  }
}

export function createWebhookOutbox(
  db: Database | null,
  endpoints: EntityStore<WebhookEndpoint>,
  events: EntityStore<WebhookEvent>,
): WebhookOutbox {
  return db ? new PgWebhookOutbox(db) : new InProcessWebhookOutbox(endpoints, events);
}

/** Queue a seller webhook; never throws (a webhook must not undo money movement). */
export function emitWebhook(outbox: WebhookOutbox, input: WebhookEmitInput): Promise<void> {
  return emitWebhookSafely(outbox, input);
}
