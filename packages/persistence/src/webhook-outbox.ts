/**
 * Seller webhook outbox.
 *
 * Every app that settles money (checkout confirm, worker confirmations and
 * subscription pulls, API refunds / cancels) calls {@link WebhookOutbox.enqueue}
 * with a business key. The event is written to `webhook_events` under an id
 * derived from (org, type, key), so the same fact emitted twice (checkout and
 * worker both confirming one payment) produces ONE event. One
 * `worker_webhook_jobs` row per matching active endpoint is queued; the
 * worker's webhook-retry job signs (`SettleKit-Signature: t=..,v1=..`) and
 * delivers them with backoff.
 */
import { createHash } from "node:crypto";
import type { WebhookEndpoint, WebhookEvent, WebhookEventType } from "@settlekit/common";
import { type Database, webhookEndpoints, webhookEvents, workerWebhookJobs } from "@settlekit/database";
import { packDoc, unpackDocs } from "./codec.js";
import { DEFAULT_MERCHANT_ID } from "./seed.js";

export interface WebhookEmitInput {
  organizationId: string;
  type: WebhookEventType;
  data: Record<string, unknown>;
  /** Business key (payment id, charge id, refund id...) that makes the emit idempotent. */
  key: string;
  now?: Date;
}

export interface WebhookEmitResult {
  eventId: string;
  /** Deliveries queued for this emit (0 for a duplicate or no subscribed endpoint). */
  queued: number;
  duplicate: boolean;
}

export interface WebhookOutbox {
  enqueue(input: WebhookEmitInput): Promise<WebhookEmitResult>;
}

/** Stable event id for (org, type, key). */
export function webhookEventId(organizationId: string, type: string, key: string): string {
  return `evt_${createHash("sha256").update(`${organizationId}:${type}:${key}`).digest("hex").slice(0, 24)}`;
}

/** Stable delivery-job id for (event, endpoint). */
export function webhookJobId(eventId: string, endpointId: string): string {
  return `whj_${eventId.replace(/^evt_/, "")}_${endpointId}`;
}

export function buildOutboxEvent(input: WebhookEmitInput): WebhookEvent {
  return {
    id: webhookEventId(input.organizationId, input.type, input.key),
    organizationId: input.organizationId,
    type: input.type,
    data: { ...input.data },
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

/** Endpoints of `organizationId` subscribed to `type`. */
export function subscribedEndpoints(endpoints: readonly WebhookEndpoint[], organizationId: string, type: WebhookEventType): WebhookEndpoint[] {
  return endpoints.filter((e) => e.organizationId === organizationId && e.active && e.enabledEvents.includes(type));
}

/** Postgres outbox shared by the API, checkout and worker. */
export class PgWebhookOutbox implements WebhookOutbox {
  constructor(private readonly db: Database) {}

  async enqueue(input: WebhookEmitInput): Promise<WebhookEmitResult> {
    const event = buildOutboxEvent(input);
    const inserted = await this.db
      .insert(webhookEvents)
      .values({ id: event.id, merchantId: DEFAULT_MERCHANT_ID, type: event.type, payload: packDoc(event) })
      .onConflictDoNothing({ target: webhookEvents.id })
      .returning({ id: webhookEvents.id });
    if (inserted.length === 0) return { eventId: event.id, queued: 0, duplicate: true };

    const rows = await this.db.select({ metadata: webhookEndpoints.metadata }).from(webhookEndpoints);
    const targets = subscribedEndpoints(unpackDocs<WebhookEndpoint>(rows), input.organizationId, input.type);
    for (const endpoint of targets) {
      const job = {
        id: webhookJobId(event.id, endpoint.id),
        endpoint,
        event,
        status: "pending" as const,
        attempts: 0,
        createdAt: event.createdAt,
      };
      await this.db
        .insert(workerWebhookJobs)
        .values({ id: job.id, status: job.status, metadata: packDoc(job) })
        .onConflictDoNothing({ target: workerWebhookJobs.id });
    }
    return { eventId: event.id, queued: targets.length, duplicate: false };
  }
}

/** Swallow outbox failures: a webhook must never undo a settled payment. */
export async function emitWebhookSafely(outbox: WebhookOutbox | null | undefined, input: WebhookEmitInput): Promise<void> {
  if (!outbox) return;
  try {
    await outbox.enqueue(input);
  } catch (error) {
    console.warn(`[webhooks] could not queue ${input.type} (${input.key}):`, error instanceof Error ? error.message : error);
  }
}
