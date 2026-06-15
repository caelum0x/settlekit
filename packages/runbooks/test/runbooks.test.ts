import { describe, expect, it } from "vitest";
import { completeRunbookStep, runbookComplete } from "../src/index.js";

describe("runbooks", () => {
  it("tracks runbook completion", () => {
    const runbook = { id: "rb_1", title: "Delivery outage", trigger: "delivery.failed", steps: [{ title: "Check queue", completed: false }] };
    expect(runbookComplete(runbook)).toBe(false);
    expect(runbookComplete(completeRunbookStep(runbook, 0))).toBe(true);
  });
});
