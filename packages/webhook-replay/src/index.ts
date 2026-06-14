import type { WebhookEvent } from "@settlekit/common";

export interface WebhookReplay {
  eventId: string;
  endpointId: string;
  status: "queued" | "delivered" | "failed";
  attempts: number;
  lastError?: string;
}

export function queueWebhookReplay(event: WebhookEvent, endpointId: string): WebhookReplay {
  return { eventId: event.id, endpointId, status: "queued", attempts: 0 };
}

export function recordReplayAttempt(replay: WebhookReplay, ok: boolean, error?: string): WebhookReplay {
  return { ...replay, status: ok ? "delivered" : "failed", attempts: replay.attempts + 1, lastError: ok ? undefined : error };
}
