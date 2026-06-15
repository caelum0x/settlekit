import { describe, expect, it } from "vitest";
import { slaBreached, uptimePercent } from "../src/index.js";

describe("sla", () => {
  it("calculates uptime and breach state", () => {
    expect(uptimePercent({ downtimeMinutes: 60, periodMinutes: 600 })).toBe(90);
    expect(slaBreached({ name: "Business", uptimeTargetPercent: 99, responseTimeHours: 4 }, { downtimeMinutes: 60, periodMinutes: 600 })).toBe(true);
  });
});
