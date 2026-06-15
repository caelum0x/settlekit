import { describe, expect, it } from "vitest";
import { openDispute, submitDisputeEvidence } from "../src/index.js";

describe("disputes", () => {
  it("opens disputes with evidence deadlines", () => {
    const dispute = openDispute({ id: "dsp_1", paymentId: "pay_1", amount: { amount: "25", currency: "USDC" }, reason: "not_received" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(dispute.evidenceDueAt).toBe("2026-01-08T00:00:00.000Z");
    expect(submitDisputeEvidence(dispute).status).toBe("under_review");
  });
});
