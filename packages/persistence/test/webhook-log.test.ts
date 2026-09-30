import { describe, expect, it } from "vitest";
import type { WebhookEndpoint, WebhookEvent } from "@settlekit/common";
import {
  InMemoryWebhookJobStore,
  MAX_JOB_ATTEMPTS,
  applyEndpointOutcome,
  deliveryView,
  enableEndpoint,
  isJobDue,
  manualJob,
  nextRetryDelayMs,
  recordJobAttempts,
  rotateEndpointSecret,
  type WebhookDeliveryJob,
} from "../src/webhook-log.js";

const endpoint: WebhookEndpoint = {
  id: "we_1",
  organizationId: "org_1",
  url: "https://hooks.test/in",
  signingSecret: "secret_1",
  enabledEvents: ["payment.confirmed"],
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
};
const event: WebhookEvent = { id: "evt_1", organizationId: "org_1", type: "payment.confirmed", data: {}, createdAt: "2026-09-30T00:00:00.000Z" };
const job: WebhookDeliveryJob = { id: "whj_1", endpoint, event, status: "pending", attempts: 0 };
const NOW = new Date("2026-09-30T10:00:00.000Z");
const fail = (status = 500) => ({ at: NOW.toISOString(), status, ok: false, error: `HTTP ${status}` });
const ok = { at: NOW.toISOString(), status: 200, ok: true };

describe("webhook delivery log", () => {
  it("records failures with backoff and delivery with a timestamp", () => {
    const failed = recordJobAttempts(job, [fail(), fail(502)], NOW);
    expect(failed).toMatchObject({ status: "failed", attempts: 2, nextAttemptAt: new Date(NOW.getTime() + 120_000).toISOString() });
    expect(failed.history).toHaveLength(2);
    expect(isJobDue(failed, NOW)).toBe(false);
    expect(isJobDue(failed, new Date(NOW.getTime() + 120_000))).toBe(true);

    const delivered = recordJobAttempts(failed, [fail(), ok], NOW);
    expect(delivered).toMatchObject({ status: "delivered", attempts: 4, deliveredAt: NOW.toISOString() });
    expect(delivered.nextAttemptAt).toBeUndefined();
    expect(isJobDue(delivered, NOW)).toBe(false);

    const exhausted = recordJobAttempts({ ...job, attempts: MAX_JOB_ATTEMPTS - 1 }, [fail()], NOW);
    expect(exhausted.nextAttemptAt).toBeUndefined();
    expect(isJobDue(exhausted, NOW)).toBe(false);
    expect(nextRetryDelayMs(30)).toBe(6 * 60 * 60 * 1000);
  });

  it("caps history and never exposes secrets in the view", () => {
    const many = recordJobAttempts(job, Array.from({ length: 30 }, () => fail()), NOW);
    expect(many.history).toHaveLength(20);
    const view = deliveryView(many);
    expect(view).toMatchObject({ eventId: "evt_1", endpointId: "we_1", lastStatus: 500, lastError: "HTTP 500" });
    expect(JSON.stringify(view)).not.toContain("secret_1");
  });

  it("disables an endpoint after too many failures in a row and resets on success", () => {
    const streak = applyEndpointOutcome({ ...endpoint, consecutiveFailures: 8 }, [fail(), fail()], NOW, 10);
    expect(streak).toMatchObject({ active: false, consecutiveFailures: 10, disabledAt: NOW.toISOString() });
    expect(streak.disabledReason).toMatch(/10 failed deliveries/);
    expect(applyEndpointOutcome({ ...endpoint, consecutiveFailures: 8 }, [fail(), ok], NOW, 10)).toMatchObject({ active: true, consecutiveFailures: 0 });
    expect(applyEndpointOutcome({ ...endpoint, consecutiveFailures: 3 }, [ok, fail()], NOW, 10).consecutiveFailures).toBe(1);
    expect(enableEndpoint(streak)).toMatchObject({ active: true, consecutiveFailures: 0 });
    expect(enableEndpoint(streak).disabledAt).toBeUndefined();
  });

  it("rotates secrets with a grace window", () => {
    const rotated = rotateEndpointSecret(endpoint, NOW, 3_600_000, "secret_2");
    expect(rotated).toMatchObject({
      signingSecret: "secret_2",
      previousSigningSecret: "secret_1",
      previousSecretExpiresAt: "2026-09-30T11:00:00.000Z",
    });
    const immediate = rotateEndpointSecret(endpoint, NOW, 0, "secret_3");
    expect(immediate.previousSigningSecret).toBeUndefined();
  });

  it("stores manual jobs per organization, newest first", async () => {
    const store = new InMemoryWebhookJobStore();
    await store.save({ ...job, createdAt: "2026-09-30T09:00:00.000Z" });
    const resend = manualJob(event, endpoint, "resend", NOW);
    await store.save(resend);
    await store.save({ ...job, id: "whj_other", event: { ...event, organizationId: "org_2" } });
    const list = await store.listByOrganization("org_1");
    expect(list.map((j) => j.id)).toEqual([resend.id, "whj_1"]);
    expect(resend.id).toMatch(/^whj_resend_/);
    expect((await store.findById(resend.id))?.manual).toBe("resend");
  });
});
