import { describe, expect, it } from "vitest";
import { resolveIncident, startMitigation } from "../src/index.js";

describe("incident response", () => {
  it("starts mitigation and resolves incidents", () => {
    const plan = { incidentId: "inc_1", commanderId: "user_1", status: "open" as const, actions: [{ action: "Pause delivery" }] };
    expect(startMitigation(plan).status).toBe("mitigating");
    expect(resolveIncident(plan).actions[0]?.completedAt).toBeDefined();
  });
});
