import { describe, it, expect } from "vitest";
import { buildWebhookEvent, serializeEvent } from "../src/events.js";

describe("buildWebhookEvent", () => {
  it("generates an evt_-prefixed id and copies data", () => {
    const data = { paymentId: "pay_1" };
    const event = buildWebhookEvent("payment.confirmed", data, {
      organizationId: "org_1",
      now: new Date("2026-06-15T12:00:00.000Z"),
    });

    expect(event.id).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(event.type).toBe("payment.confirmed");
    expect(event.organizationId).toBe("org_1");
    expect(event.createdAt).toBe("2026-06-15T12:00:00.000Z");

    // data is copied, not referenced.
    expect(event.data).toEqual(data);
    expect(event.data).not.toBe(data);
  });

  it("produces unique ids across calls", () => {
    const a = buildWebhookEvent("delivery.succeeded", {}, { organizationId: "org_1" });
    const b = buildWebhookEvent("delivery.succeeded", {}, { organizationId: "org_1" });
    expect(a.id).not.toBe(b.id);
  });

  it("serializeEvent yields stable JSON matching the event", () => {
    const event = buildWebhookEvent(
      "subscription.created",
      { subscriptionId: "sub_1" },
      { organizationId: "org_1", now: new Date("2026-06-15T00:00:00.000Z") },
    );
    expect(JSON.parse(serializeEvent(event))).toEqual(event);
  });
});
