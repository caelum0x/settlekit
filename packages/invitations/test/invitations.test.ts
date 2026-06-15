import { describe, expect, it } from "vitest";
import { acceptInvitation, createInvitation } from "../src/index.js";

describe("invitations", () => {
  it("creates normalized invitations and accepts before expiry", () => {
    const invitation = createInvitation({ email: "USER@EXAMPLE.COM", role: "admin", token: "tok_1" }, new Date("2026-01-01T00:00:00.000Z"));
    expect(invitation.email).toBe("user@example.com");
    expect(acceptInvitation(invitation, new Date("2026-01-02T00:00:00.000Z")).status).toBe("accepted");
  });
});
