import { serializeEvent } from "./events.js";
import { EVENT_HEADER, SIGNATURE_HEADER, signPayload } from "./signing.js";
import type {
  ClockFn,
  DeliverWebhookParams,
  DeliverWithRetryParams,
  DeliveryAttempt,
  DeliveryResult,
  HttpSender,
  RetryOutcome,
  SleepFn,
  WebhookRequest,
} from "./types.js";

/**
 * Default exponential backoff schedule in seconds. The first attempt fires
 * immediately (delay 0); each subsequent retry waits 5x longer. A worker can
 * persist this array to drive scheduled redelivery across process restarts.
 */
export const DEFAULT_BACKOFF_SCHEDULE: readonly number[] = [0, 1, 5, 25, 125] as const;

/** Real sleep backed by `setTimeout`. */
const realSleep: SleepFn = (seconds) =>
  new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds) * 1000));

/** Real clock returning milliseconds since epoch. */
const realClock: ClockFn = () => Date.now();

/**
 * Production HTTP sender backed by the global `fetch`. Transport-level failures
 * are captured as a non-ok result with `status: 0` rather than throwing, so the
 * retry loop can treat them uniformly with HTTP error responses.
 */
export const fetchSender: HttpSender = {
  async send(request: WebhookRequest): Promise<DeliveryResult> {
    try {
      const response = await fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
      });
      return { status: response.status, ok: response.ok };
    } catch (cause) {
      return {
        status: 0,
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      };
    }
  },
};

/**
 * Build the fully-prepared, signed HTTP request for an event delivery. Exposed
 * so a worker can construct, persist, and replay the exact bytes that were sent.
 */
export function buildWebhookRequest(
  params: Pick<DeliverWebhookParams, "endpoint" | "event"> & { clock?: ClockFn },
): WebhookRequest {
  const { endpoint, event } = params;
  const clock = params.clock ?? realClock;
  const body = serializeEvent(event);
  const timestamp = Math.floor(clock() / 1000);
  const signature = signPayload(endpoint.signingSecret, body, timestamp);

  return {
    url: endpoint.url,
    body,
    headers: {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: signature,
      [EVENT_HEADER]: event.type,
    },
  };
}

/**
 * Deliver a single webhook event over HTTP POST with HMAC signing headers.
 * Returns `{ status, ok }` describing the response.
 */
export async function deliverWebhook(params: DeliverWebhookParams): Promise<DeliveryResult> {
  const sender = params.sender ?? fetchSender;
  const request = buildWebhookRequest({
    endpoint: params.endpoint,
    event: params.event,
    clock: params.clock,
  });
  return sender.send(request);
}

/**
 * Deliver an event with exponential backoff retries. Sleeps the scheduled delay
 * before each attempt, stops as soon as an attempt succeeds, and returns the full
 * list of attempts plus the schedule used.
 *
 * Both `sleep` and `clock` are injectable for deterministic testing; they default
 * to real timers.
 */
export async function deliverWithRetry(params: DeliverWithRetryParams): Promise<RetryOutcome> {
  const schedule = params.schedule ?? DEFAULT_BACKOFF_SCHEDULE;
  const sleep = params.sleep ?? realSleep;
  const clock = params.clock ?? realClock;
  const sender = params.sender ?? fetchSender;

  const attempts: DeliveryAttempt[] = [];

  for (let i = 0; i < schedule.length; i++) {
    const delaySec = schedule[i] ?? 0;
    if (delaySec > 0) {
      await sleep(delaySec);
    }

    // Re-sign on each attempt so the timestamp stays within tolerance windows.
    const request = buildWebhookRequest({
      endpoint: params.endpoint,
      event: params.event,
      clock,
    });
    const result = await sender.send(request);

    attempts.push({ attempt: i, delaySec, at: clock(), result });

    if (result.ok) {
      return { ok: true, attempts, schedule };
    }
  }

  return { ok: false, attempts, schedule };
}
