import { describe, expect, it } from "vitest";
import { evaluateAlertRule, highestAlertSeverity } from "../src/index.js";

describe("alerts", () => {
  it("evaluates alert rules", () => {
    const alert = evaluateAlertRule({ id: "rule_1", metric: "delivery_failures", threshold: 5, severity: "critical", enabled: true }, 6);
    expect(alert?.severity).toBe("critical");
    expect(highestAlertSeverity([alert!])).toBe("critical");
  });
});
