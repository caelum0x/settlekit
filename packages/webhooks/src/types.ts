import type { WebhookEndpoint, WebhookEvent } from "@settlekit/common";

/**
 * Parsed components of a `SettleKit-Signature` header.
 * Format: `t=<unix-seconds>,v1=<hex-hmac-sha256>`.
 */
export interface ParsedSignature {
  /** Unix timestamp (seconds) the signature was produced for. */
  timestamp: number;
  /** Hex-encoded HMAC-SHA256 of `"<timestamp>.<payloadJson>"`. */
  signature: string;
}

/** Result of a single HTTP delivery attempt. */
export interface DeliveryResult {
  /** HTTP status code returned by the endpoint (0 when the request threw). */
  status: number;
  /** True when the endpoint returned a 2xx status. */
  ok: boolean;
  /** Optional transport-level error message (network failure, timeout, etc.). */
  error?: string;
}

/** Record of a single attempt within a retry sequence. */
export interface DeliveryAttempt {
  /** Zero-based attempt index. */
  attempt: number;
  /** Delay (seconds) waited before this attempt was made. */
  delaySec: number;
  /** Unix timestamp (ms) when the attempt was made, from the injected clock. */
  at: number;
  /** Outcome of the attempt. */
  result: DeliveryResult;
}

/** Final outcome of a `deliverWithRetry` run. */
export interface RetryOutcome {
  /** True if any attempt returned a 2xx response. */
  ok: boolean;
  /** Every attempt made, in order. */
  attempts: DeliveryAttempt[];
  /** The backoff schedule (seconds) that was used. */
  schedule: readonly number[];
}

/**
 * Narrow HTTP sender interface. The production default is backed by the global
 * `fetch`, but tests construct an in-memory implementation to drive retry logic
 * deterministically.
 */
export interface HttpSender {
  send(request: WebhookRequest): Promise<DeliveryResult>;
}

/** A fully-prepared outbound webhook HTTP request. */
export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/** Injectable sleep function (seconds). Defaults to real `setTimeout`. */
export type SleepFn = (seconds: number) => Promise<void>;

/** Injectable clock returning milliseconds since epoch. Defaults to `Date.now`. */
export type ClockFn = () => number;

export interface DeliverWebhookParams {
  endpoint: WebhookEndpoint;
  event: WebhookEvent;
  /** Override the default fetch-backed sender (e.g. for tests). */
  sender?: HttpSender;
  /** Clock used to stamp the signature timestamp. Defaults to `Date.now`. */
  clock?: ClockFn;
}

export interface DeliverWithRetryParams extends DeliverWebhookParams {
  /** Backoff schedule in seconds. Defaults to {@link DEFAULT_BACKOFF_SCHEDULE}. */
  schedule?: readonly number[];
  /** Injected sleep for determinism. Defaults to real timers. */
  sleep?: SleepFn;
}
