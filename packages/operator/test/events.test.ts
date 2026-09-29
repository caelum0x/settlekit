import { describe, expect, it } from "vitest";
import { EventValidationError, parseOperatorEvent } from "../src/events.js";

const base = { id: "evt_1", orgId: "org_1", at: "2026-10-01T12:00:00Z" };

describe("parseOperatorEvent", () => {
  it("parses each event type with bigint amounts", () => {
    expect(parseOperatorEvent({ ...base, type: "revenue.received", amount: "25000000", payer: "0xabc", paymentRef: "0xtx" })).toMatchObject({ amount: 25_000_000n, at: "2026-10-01T12:00:00.000Z" });
    expect(parseOperatorEvent({ ...base, type: "bill.due", amount: 5, billId: "b1", payee: "0xv", description: "hosting", dueAt: "2026-10-05" })).toMatchObject({ amount: 5n, dueAt: "2026-10-05T00:00:00.000Z" });
    expect(parseOperatorEvent({ ...base, type: "refund.requested", amount: 7n, customer: "0xc", paymentRef: "p", reason: "unused" }).type).toBe("refund.requested");
    expect(parseOperatorEvent({ ...base, type: "dispute.opened", amount: "9", disputeId: "d1", customer: "0xc", paymentRef: "p" }).type).toBe("dispute.opened");
    const tick = parseOperatorEvent({ ...base, type: "tick" });
    expect(tick.type).toBe("tick");
    expect(Object.isFrozen(tick)).toBe(true);
  });

  it("collects every issue", () => {
    try {
      parseOperatorEvent({ type: "bill.due", id: "", orgId: "o", at: "nope", amount: "-1", payee: 3 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EventValidationError);
      const issues = (error as EventValidationError).issues;
      expect(issues).toEqual(expect.arrayContaining([
        "id must be a non-empty string", "payee must be a non-empty string", "at must be an ISO timestamp",
        "dueAt must be an ISO timestamp", "amount must be a positive base-unit integer",
      ]));
    }
  });

  it("rejects non-objects, unknown types and bad amounts", () => {
    expect(() => parseOperatorEvent(null)).toThrow(/object/);
    expect(() => parseOperatorEvent([])).toThrow(/object/);
    expect(() => parseOperatorEvent({ ...base, type: "wire.sent" })).toThrow(/unknown event type/);
    for (const amount of [0, 0n, "1.5", 1.5, "0", Number.MAX_SAFE_INTEGER + 2, undefined]) {
      expect(() => parseOperatorEvent({ ...base, type: "revenue.received", amount, payer: "p", paymentRef: "r" })).toThrow(EventValidationError);
    }
  });
});
