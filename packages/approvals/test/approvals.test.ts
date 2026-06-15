import { describe, expect, it } from "vitest";
import { addApproval, rejectApproval } from "../src/index.js";

describe("approvals", () => {
  it("approves after enough approvers", () => {
    const request = { id: "apr_1", resourceId: "payout_1", requiredApprovals: 2, approverIds: [], status: "pending" as const };
    expect(addApproval(addApproval(request, "user_1"), "user_2").status).toBe("approved");
    expect(rejectApproval(request).status).toBe("rejected");
  });
});
