import { describe, expect, it } from "vitest";
import { unwrap } from "@settlekit/common";
import { openDispute, submitEvidence } from "../src/index.js";

describe("disputes", () => {
  it("opens a dispute and moves to under_review when evidence is submitted", () => {
    let n = 0;
    const gen = () => `dsp_${++n}`;
    const opened = unwrap(
      openDispute(
        { paymentId: "pay_1", customerId: "cus_1", reason: "not_received" },
        gen,
        new Date("2026-01-01T00:00:00.000Z"),
      ),
    );
    expect(opened.status).toBe("open");

    const reviewed = unwrap(
      submitEvidence(opened, { kind: "text", description: "tracking number", value: "1Z999" }, gen),
    );
    expect(reviewed.status).toBe("under_review");
    expect(reviewed.evidence.length).toBe(1);
  });
});
