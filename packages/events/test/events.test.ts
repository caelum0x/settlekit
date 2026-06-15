import { describe, expect, it } from "vitest";
import { createDomainEvent, eventsForAggregate, eventTypes } from "../src/index.js";

describe("events", () => {
  it("creates and filters domain events", () => {
    const event = createDomainEvent({ id: "evt_1", type: "product.created", aggregateId: "prod_1", data: { name: "Repo" } });
    expect(eventsForAggregate([event], "prod_1")).toHaveLength(1);
    expect(eventTypes([event])).toEqual(["product.created"]);
  });
});
