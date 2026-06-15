import { describe, expect, it } from "vitest";
import { inviteWaitlistEntry, joinWaitlist, waitlistPosition } from "../src/index.js";

describe("waitlist", () => {
  it("tracks waitlist entries", () => {
    const entry = joinWaitlist("BUYER@EXAMPLE.COM", "marketplace");
    expect(entry.email).toBe("buyer@example.com");
    expect(waitlistPosition([entry], "buyer@example.com")).toBe(1);
    expect(inviteWaitlistEntry(entry).status).toBe("invited");
  });
});
