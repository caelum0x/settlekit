import { describe, expect, it } from "vitest";
import type { WebhookEndpoint, WebhookEvent } from "@settlekit/common";
import type { HttpSender, WebhookRequest } from "@settlekit/webhooks";
import { InMemoryWorkerStore, type WebhookJob } from "../src/stores.js";
import type { JobContext } from "../src/jobs/types.js";
import { webhookRetryJob } from "../src/jobs/webhook-retry-job.js";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const endpoint: WebhookEndpoint = {
  id: "we_1",
  organizationId: "org_1",
  url: "https://hooks.test/in",
  signingSecret: "old_secret",
  enabledEvents: ["payment.confirmed"],
  active: true,
  createdAt: "2026-09-01T00:00:00.000Z",
};
const event: WebhookEvent = { id: "evt_1", organizationId: "org_1", type: "payment.confirmed", data: { paymentId: "pay_1" }, createdAt: NOW.toISOString() };

function sender(statuses: number[]): HttpSender & { requests: WebhookRequest[] } {
  const requests: WebhookRequest[] = [];
  return {
    requests,
    async send(request) {
      requests.push(request);
      const status = statuses.shift() ?? 500;
      return { status, ok: status >= 200 && status < 300 };
    },
  };
}

function ctxWith(store: InMemoryWorkerStore, http: HttpSender, now = NOW): JobContext {
  return {
    stores: store,
    webhookTransport: { sender: http, sleep: async () => {} },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    now: () => now,
  } as unknown as JobContext;
}

async function seed(overrides: Partial<WebhookEndpoint> = {}): Promise<InMemoryWorkerStore> {
  const store = new InMemoryWorkerStore();
  const job: WebhookJob = { id: "whj_1", endpoint, event, status: "pending", attempts: 0 };
  await store.upsertWebhookJob(job);
  await store.saveWebhookEndpoint({ ...endpoint, ...overrides });
  return store;
}

describe("webhookRetryJob", () => {
  it("delivers with the live secret and logs the attempt", async () => {
    const store = await seed({ signingSecret: "live_secret", previousSigningSecret: "old_secret", previousSecretExpiresAt: "2026-10-01T00:00:00.000Z" });
    const http = sender([200]);
    expect(await webhookRetryJob.run(ctxWith(store, http))).toEqual({ processed: 1, failed: 0 });
    const [job] = await store.pendingWebhookJobs();
    expect(job).toBeUndefined();
    // Rotation grace: two v1 values, new secret first.
    expect(http.requests[0]!.headers["SettleKit-Signature"]!.match(/v1=/g)).toHaveLength(2);
  });

  it("backs off after failures and records status codes", async () => {
    const store = await seed();
    const http = sender([500, 502, 503]);
    expect(await webhookRetryJob.run(ctxWith(store, http))).toEqual({ processed: 1, failed: 1 });
    const [job] = await store.pendingWebhookJobs();
    expect(job).toMatchObject({ status: "failed", attempts: 3 });
    expect(job!.history!.map((a) => a.status)).toEqual([500, 502, 503]);
    expect(job!.nextAttemptAt).toBe(new Date(NOW.getTime() + 240_000).toISOString());

    // Not due yet on the next tick.
    expect(await webhookRetryJob.run(ctxWith(store, sender([200])))).toEqual({ processed: 0, failed: 0 });
    // Due later: delivered.
    const later = new Date(NOW.getTime() + 240_000);
    expect(await webhookRetryJob.run(ctxWith(store, sender([200]), later))).toEqual({ processed: 1, failed: 0 });
    expect((await store.getWebhookEndpoint("we_1"))?.consecutiveFailures).toBe(0);
  });

  it("skips disabled endpoints and disables one that keeps failing", async () => {
    const disabled = await seed({ active: false });
    const http = sender([200]);
    expect(await webhookRetryJob.run(ctxWith(disabled, http))).toEqual({ processed: 0, failed: 0 });
    expect(http.requests).toHaveLength(0);

    process.env.WEBHOOK_DISABLE_AFTER_FAILURES = "5";
    try {
      const store = await seed({ consecutiveFailures: 3 });
      await webhookRetryJob.run(ctxWith(store, sender([500, 500, 500])));
      const health = await store.getWebhookEndpoint("we_1");
      expect(health).toMatchObject({ active: false, consecutiveFailures: 6 });
      expect(health?.disabledReason).toMatch(/6 failed deliveries/);
    } finally {
      delete process.env.WEBHOOK_DISABLE_AFTER_FAILURES;
    }
  });
});
