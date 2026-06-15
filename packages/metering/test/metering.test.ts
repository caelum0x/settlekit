import { describe, expect, it } from "vitest";
import { aggregateMeterEvents, createMeterEvent, dedupeMeterEvents } from "../src/index.js";

describe("metering", () => {
  it("creates, dedupes, and aggregates meter events", () => {
    const event = createMeterEvent({ meterId: "meter_1", customerId: "cus_1", quantity: 3, idempotencyKey: "evt_1" });
    expect(aggregateMeterEvents(dedupeMeterEvents([event, event]))).toBe(3);
  });
});
