import { describe, expect, it } from "vitest";
import { approveEscrowWork, createEscrowTask, markEscrowFunded, releaseEscrow, submitEscrowWork } from "../src/index.js";

describe("escrow release", () => {
  it("moves through funded submission approval release", () => {
    const created = createEscrowTask({ organizationId: "org_1", buyerCustomerId: "cus_1", title: "Fix bug", description: "", amount: "10", currency: "USDC" });
    const released = releaseEscrow(approveEscrowWork(submitEscrowWork({ ...markEscrowFunded(created, "0x1"), status: "assigned" })), "0x2");
    expect(released.status).toBe("released");
  });
});
