import { describe, it, expect } from "vitest";
import type { WebhookEndpoint } from "@settlekit/common";
import {
  DEFAULT_BACKOFF_SCHEDULE,
  buildWebhookRequest,
  deliverWebhook,
  deliverWithRetry,
} from "../src/delivery.js";
import { buildWebhookEvent } from "../src/events.js";
import {
  EVENT_HEADER,
  SIGNATURE_HEADER,
  verifySignature,
} from "../src/signing.js";
import type {
  DeliveryResult,
  HttpSender,
  WebhookRequest,
} from "../src/types.js";

const SECRET = "whsec_test_secret_value";

const endpoint: WebhookEndpoint = {
  id: "we_123",
  organizationId: "org_123",
  url: "https://example.test/hooks",
  signingSecret: SECRET,
  enabledEvents: ["payment.confirmed"],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const event = buildWebhookEvent(
  "payment.confirmed",
  { paymentId: "pay_1", amount: "10.00" },
  { organizationId: "org_123", now: new Date("2026-01-02T00:00:00.000Z") },
);

/**
 * In-memory sender (a real implementation of the HttpSender interface) that
 * returns scripted results and records every request it receives.
 */
function scriptedSender(results: DeliveryResult[]): {
  sender: HttpSender;
  requests: WebhookRequest[];
} {
  const requests: WebhookRequest[] = [];
  let i = 0;
  const sender: HttpSender = {
    async send(request) {
      requests.push(request);
      const result = results[Math.min(i, results.length - 1)];
      i += 1;
      return result ?? { status: 500, ok: false };
    },
  };
  return { sender, requests };
}

/** Fixed clock so the signed timestamp is deterministic. */
const fixedClock = () => 1700000000_000;

describe("buildWebhookRequest", () => {
  it("attaches a verifiable signature and the standard headers", () => {
    const request = buildWebhookRequest({ endpoint, event, clock: fixedClock });

    expect(request.url).toBe(endpoint.url);
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers[EVENT_HEADER]).toBe("payment.confirmed");

    const sigHeader = request.headers[SIGNATURE_HEADER];
    expect(sigHeader).toBeDefined();
    expect(
      verifySignature(SECRET, request.body, sigHeader!, 300, 1700000000),
    ).toBe(true);
  });
});

describe("deliverWebhook", () => {
  it("returns { status, ok } from the injected sender", async () => {
    const { sender, requests } = scriptedSender([{ status: 200, ok: true }]);
    const result = await deliverWebhook({ endpoint, event, sender, clock: fixedClock });

    expect(result).toEqual({ status: 200, ok: true });
    expect(requests).toHaveLength(1);
  });

  it("reports a non-ok status without throwing", async () => {
    const { sender } = scriptedSender([{ status: 503, ok: false }]);
    const result = await deliverWebhook({ endpoint, event, sender, clock: fixedClock });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });
});

describe("deliverWithRetry", () => {
  /** Sleep that records the requested delays instead of waiting. */
  function recordingSleep(): { sleep: (s: number) => Promise<void>; delays: number[] } {
    const delays: number[] = [];
    return {
      delays,
      sleep: async (s) => {
        delays.push(s);
      },
    };
  }

  it("stops immediately after the first successful attempt", async () => {
    const { sender, requests } = scriptedSender([
      { status: 500, ok: false },
      { status: 200, ok: true },
      { status: 200, ok: true },
    ]);
    const { sleep, delays } = recordingSleep();

    const outcome = await deliverWithRetry({
      endpoint,
      event,
      sender,
      sleep,
      clock: fixedClock,
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toHaveLength(2);
    expect(requests).toHaveLength(2);
    // First attempt has no delay; the retry waited schedule[1] = 1s.
    expect(delays).toEqual([1]);
    expect(outcome.attempts[0]!.result.ok).toBe(false);
    expect(outcome.attempts[1]!.result.ok).toBe(true);
  });

  it("exhausts the schedule and reports failure when every attempt fails", async () => {
    const { sender, requests } = scriptedSender([{ status: 500, ok: false }]);
    const { sleep, delays } = recordingSleep();

    const outcome = await deliverWithRetry({
      endpoint,
      event,
      sender,
      sleep,
      clock: fixedClock,
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toHaveLength(DEFAULT_BACKOFF_SCHEDULE.length);
    expect(requests).toHaveLength(DEFAULT_BACKOFF_SCHEDULE.length);
    // delay 0 of the first attempt is not slept; the rest are.
    expect(delays).toEqual([1, 5, 25, 125]);
    expect(outcome.schedule).toBe(DEFAULT_BACKOFF_SCHEDULE);
  });

  it("honors a custom schedule and records per-attempt metadata", async () => {
    const { sender } = scriptedSender([{ status: 500, ok: false }]);
    const { sleep, delays } = recordingSleep();
    const schedule = [0, 2, 4] as const;

    const outcome = await deliverWithRetry({
      endpoint,
      event,
      sender,
      sleep,
      schedule,
      clock: fixedClock,
    });

    expect(outcome.attempts.map((a) => a.attempt)).toEqual([0, 1, 2]);
    expect(outcome.attempts.map((a) => a.delaySec)).toEqual([0, 2, 4]);
    expect(outcome.attempts.every((a) => a.at === fixedClock())).toBe(true);
    expect(delays).toEqual([2, 4]);
  });

  it("default schedule is the documented exponential backoff", () => {
    expect(DEFAULT_BACKOFF_SCHEDULE).toEqual([0, 1, 5, 25, 125]);
  });
});
