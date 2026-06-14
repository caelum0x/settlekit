import { describe, expect, it } from "vitest";
import { queueWebhookReplay, recordReplayAttempt } from "../src/index.js";

describe("webhook replay", () => {
  it("queues and records replay attempts", () => {
    const event = { id: "evt_1", organizationId: "org_1", type: "payment.confirmed" as const, data: {}, createdAt: "" };
    expect(recordReplayAttempt(queueWebhookReplay(event, "we_1"), false, "timeout")).toMatchObject({ status: "failed", attempts: 1 });
  });
});
