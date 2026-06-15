import { describe, expect, it } from "vitest";
import { assignSeat, removeSeat, seatsRemaining } from "../src/index.js";

describe("seats", () => {
  it("assigns and removes organization seats", () => {
    const pool = assignSeat({ organizationId: "org_1", limit: 1, assignedUserIds: [] }, "user_1");
    expect(seatsRemaining(pool)).toBe(0);
    expect(removeSeat(pool, "user_1").assignedUserIds).toEqual([]);
  });
});
