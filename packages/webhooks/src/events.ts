import { generateId } from "@settlekit/common";
import { toIso } from "@settlekit/common";
import type { WebhookEvent, WebhookEventType } from "@settlekit/common";

export interface BuildWebhookEventOptions {
  /** Owning organization. Required to scope events to a tenant. */
  organizationId: string;
  /** Override the creation timestamp (defaults to now). */
  now?: Date;
}

/**
 * Construct a {@link WebhookEvent} with a freshly generated, prefixed id.
 *
 * The id uses the `webhookEvent` resource prefix (`evt_...`) from
 * `@settlekit/common`, and the data is shallow-copied so callers cannot mutate
 * the event after construction.
 */
export function buildWebhookEvent(
  type: WebhookEventType,
  data: Record<string, unknown>,
  options: BuildWebhookEventOptions,
): WebhookEvent {
  return {
    id: generateId("webhookEvent"),
    organizationId: options.organizationId,
    type,
    data: { ...data },
    createdAt: toIso(options.now ?? new Date()),
  };
}

/**
 * Serialize an event to the exact JSON string used both as the HTTP body and as
 * the HMAC signing input, so the receiver can reproduce the signature byte-for-byte.
 */
export function serializeEvent(event: WebhookEvent): string {
  return JSON.stringify(event);
}
