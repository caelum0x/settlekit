/**
 * Webhooks resource client. Maps to `/v1/webhooks`.
 *
 * Manage webhook endpoints (url + signing secret + enabled events) and emit
 * events. Emitting returns the signed payload deliveries per matching endpoint.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookEndpoint, WebhookEvent, WebhookEventType } from "@settlekit/common";
import type { HttpClient, RequestOptions } from "../http-client.js";

/** The header SettleKit sends the signature in (HTTP header lookup is case-insensitive). */
export const WEBHOOK_SIGNATURE_HEADER = "SettleKit-Signature";

/** Options for {@link verifyWebhookSignature}. */
export interface VerifyWebhookOptions {
  /**
   * Max age (seconds) of the signed timestamp before a payload is rejected as a
   * possible replay. Defaults to 300 (5 minutes); pass `0` to skip the check.
   */
  toleranceSeconds?: number;
  /** Current time (ms) — injectable for testing. */
  now?: number;
}

/**
 * Verify an inbound SettleKit webhook signature against the raw request body.
 *
 * SettleKit signs deliveries Stripe-style: the header value is
 * `t=<unix-seconds>,v1=<hex hmac-sha256("${t}.${rawBody}", secret)>`. Pass the
 * EXACT raw body string you received (do not re-serialize the parsed JSON — key
 * order / whitespace must match). Returns `true` only when the signature is
 * valid and (unless disabled) within the tolerance window.
 */
export function verifyWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string,
  options: VerifyWebhookOptions = {},
): boolean {
  const parts = new Map<string, string>();
  for (const segment of signatureHeader.split(",")) {
    const idx = segment.indexOf("=");
    if (idx > 0) parts.set(segment.slice(0, idx).trim(), segment.slice(idx + 1).trim());
  }
  const t = parts.get("t");
  const v1 = parts.get("v1");
  if (!t || !v1) return false;

  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const ts = Number.parseInt(t, 10);
    if (!Number.isFinite(ts)) return false;
    const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
    if (Math.abs(nowSec - ts) > tolerance) return false;
  }

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

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
