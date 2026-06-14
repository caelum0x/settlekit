import { describe, expect, it } from "vitest";
import { canOpenSupportTicket, supportSlaLabel } from "../src/index.js";

describe("support plans", () => {
  it("checks ticket allowance and SLA label", () => {
    const plan = { id: "support_pro", name: "Pro Support", responseTimeHours: 24, monthlyTicketLimit: 3, channels: ["github" as const] };
    expect(canOpenSupportTicket(plan, { planId: "support_pro", ticketsUsed: 2 })).toBe(true);
    expect(supportSlaLabel(plan)).toBe("24h response");
  });
});
