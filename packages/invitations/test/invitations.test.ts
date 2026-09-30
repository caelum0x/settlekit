import { describe, expect, it } from "vitest";
import { acceptInvitation, createInvitation } from "../src/index.js";

describe("invitations", () => {
  it("creates normalized invitations and accepts before expiry", () => {
    const invitation = createInvitation({ email: "USER@EXAMPLE.COM", role: "admin", token: "tok_1" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(invitation.email).toBe("user@example.com");
    expect(acceptInvitation(invitation, new Date("2026-01-02T00:00:00.000Z")).status).toBe("accepted");
  });
});

describe("invitation lifecycle", () => {
  it("revokes only pending invitations and knows when one is open", async () => {
    const { createInvitation, revokeInvitation, isInvitationOpen, acceptInvitation } = await import("../src/index.js");
    const now = new Date("2026-09-30T00:00:00Z");
    const inv = createInvitation({ email: "Dev@Team.test", role: "developer", token: "t" }, now);
    expect(isInvitationOpen(inv, now)).toBe(true);
    expect(isInvitationOpen(inv, new Date("2026-10-08T00:00:01Z"))).toBe(false);
    expect(revokeInvitation(inv).status).toBe("revoked");
    const accepted = acceptInvitation(inv, now);
    expect(revokeInvitation(accepted).status).toBe("accepted");
    expect(isInvitationOpen(accepted, now)).toBe(false);
  });
});
