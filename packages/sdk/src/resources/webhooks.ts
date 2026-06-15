/**
 * Webhooks resource client. Maps to `/v1/webhooks`.
 *
 * Manage webhook endpoints (url + signing secret + enabled events) and emit
 * events. Emitting returns the signed payload deliveries per matching endpoint.
 */
import type { WebhookEndpoint, WebhookEvent, WebhookEventType } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** Input for {@link WebhooksResource.createEndpoint}. */
export interface CreateWebhookEndpointInput {
  organizationId: string;
  url: string;
  enabledEvents: WebhookEventType[];
}

/** Input for {@link WebhooksResource.emitEvent}. */
export interface EmitWebhookEventInput {
  organizationId: string;
  type: WebhookEventType;
  data?: Record<string, unknown>;
}

/** A single signed delivery target returned by {@link WebhooksResource.emitEvent}. */
export interface WebhookDelivery {
  endpointId: string;
  url: string;
  signature: string;
}

/** Result of emitting a webhook event. */
export interface EmitWebhookEventResult {
  event: WebhookEvent;
  deliveries: WebhookDelivery[];
}

/** Client for webhook endpoints + events. */
export class WebhooksResource {
  constructor(private readonly http: HttpClient) {}

  /** Register a webhook endpoint with a freshly-minted signing secret. */
  createEndpoint(input: CreateWebhookEndpointInput, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.http.post<WebhookEndpoint>("/v1/webhooks/endpoints", input, options);
  }

  /** List webhook endpoints, optionally filtered by organization. */
  listEndpoints(organizationId?: string, options?: RequestOptions): Promise<WebhookEndpoint[]> {
    return this.http.get<WebhookEndpoint[]>("/v1/webhooks/endpoints", {
      ...options,
      query: { ...(organizationId !== undefined ? { organizationId } : {}) },
    });
  }

  /** Emit an event; returns the signed payload for each matching endpoint. */
  emitEvent(input: EmitWebhookEventInput, options?: RequestOptions): Promise<EmitWebhookEventResult> {
    return this.http.post<EmitWebhookEventResult>("/v1/webhooks/events", input, options);
  }

  /** List emitted events, optionally filtered by organization. */
  listEvents(organizationId?: string, options?: RequestOptions): Promise<WebhookEvent[]> {
    return this.http.get<WebhookEvent[]>("/v1/webhooks/events", {
      ...options,
      query: { ...(organizationId !== undefined ? { organizationId } : {}) },
    });
  }

  /** Retrieve a single emitted event by id. */
  retrieveEvent(id: string, options?: RequestOptions): Promise<WebhookEvent> {
    return this.http.get<WebhookEvent>(`/v1/webhooks/events/${encodeURIComponent(id)}`, options);
  }
}
