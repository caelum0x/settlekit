import { describe, expect, it } from "vitest";
import { retryFailedActions } from "../src/index.js";

describe("retryFailedActions", () => {
  it("retries failed actions", async () => {
    const runs = await retryFailedActions(
      [{ id: "dact_1", action: { type: "email_send", template: "receipt" }, status: "failed", attempts: 1 }],
      { organizationId: "org_1", paymentId: "pay_1", customerId: "cus_1" },
      { email_send: async () => ({ sent: true }) },
    );
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.attempts).toBe(2);
  });
});
