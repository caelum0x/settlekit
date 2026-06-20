import { describe, expect, it } from "vitest";
import { SettleKitError } from "@settlekit/common";
import {
  assertTransition,
  canTransition,
  isTerminalJobStatus,
  peekTransition,
} from "../src/index.js";

describe("job transition table", () => {
  it("allows fund from created and forbids settle from created", () => {
    expect(canTransition("created", "fund")).toBe(true);
    expect(canTransition("created", "settle")).toBe(false);
  });

  it("peeks the target status for legal transitions", () => {
    expect(peekTransition("created", "fund")).toBe("funded");
    expect(peekTransition("funded", "submit")).toBe("submitted");
    expect(peekTransition("submitted", "evaluate_pass")).toBe("evaluated");
    expect(peekTransition("submitted", "evaluate_fail")).toBe("evaluated");
    expect(peekTransition("evaluated", "settle")).toBe("settled");
    expect(peekTransition("evaluated", "refund")).toBe("refunded");
  });

  it("returns undefined for illegal transitions", () => {
    expect(peekTransition("created", "settle")).toBeUndefined();
    expect(peekTransition("settled", "fund")).toBeUndefined();
  });

  it("assertTransition throws a conflict on an illegal move", () => {
    try {
      assertTransition("settled", "fund");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(SettleKitError.is(error)).toBe(true);
      if (!SettleKitError.is(error)) return;
      expect(error.code).toBe("conflict");
    }
  });

  it("assertTransition returns the next status on a legal move", () => {
    expect(assertTransition("created", "fund")).toBe("funded");
  });

  it("identifies terminal statuses", () => {
    expect(isTerminalJobStatus("settled")).toBe(true);
    expect(isTerminalJobStatus("refunded")).toBe(true);
    expect(isTerminalJobStatus("cancelled")).toBe(true);
    expect(isTerminalJobStatus("created")).toBe(false);
    expect(isTerminalJobStatus("evaluated")).toBe(false);
  });
});
