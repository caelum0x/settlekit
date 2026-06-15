import { describe, expect, it } from "vitest";
import { unwrap, isErr } from "@settlekit/common";
import { SeatManager } from "../src/index.js";

const now = new Date("2026-01-01T00:00:00.000Z");

describe("SeatManager", () => {
  it("adds seats up to the limit, then refuses", () => {
    const m0 = new SeatManager({ seatLimit: 2, seats: [] });
    const m1 = unwrap(m0.addSeat("user_1", now));
    const m2 = unwrap(m1.addSeat("user_2", now));

    expect(m2.used).toBe(2);
    expect(m2.available).toBe(0);

    const overflow = m2.addSeat("user_3", now);
    expect(isErr(overflow)).toBe(true);
    if (isErr(overflow)) {
      expect(overflow.error.code).toBe("payment_required");
    }
  });

  it("is immutable: original is unchanged after addSeat", () => {
    const m0 = new SeatManager({ seatLimit: 5, seats: [] });
    const m1 = unwrap(m0.addSeat("user_1", now));
    expect(m0.used).toBe(0);
    expect(m1.used).toBe(1);
  });

  it("rejects duplicate seat for the same user", () => {
    const m1 = unwrap(new SeatManager({ seatLimit: 5, seats: [] }).addSeat("user_1", now));
    const dup = m1.addSeat("user_1", now);
    expect(isErr(dup)).toBe(true);
    if (isErr(dup)) expect(dup.error.code).toBe("conflict");
  });

  it("removes a seat and frees capacity", () => {
    const m1 = unwrap(new SeatManager({ seatLimit: 1, seats: [] }).addSeat("user_1", now));
    expect(m1.available).toBe(0);
    const m2 = unwrap(m1.removeSeat("user_1"));
    expect(m2.available).toBe(1);
    expect(m2.listSeats()).toEqual([]);
  });

  it("fails to remove a non-existent seat", () => {
    const removed = new SeatManager({ seatLimit: 1, seats: [] }).removeSeat("ghost");
    expect(isErr(removed)).toBe(true);
  });

  it("listSeats returns a defensive copy", () => {
    const m1 = unwrap(new SeatManager({ seatLimit: 2, seats: [] }).addSeat("user_1", now));
    const seats = m1.listSeats();
    seats.push({ userId: "hacker", assignedAt: now.toISOString() });
    expect(m1.used).toBe(1);
  });

  it("rejects a negative seat limit", () => {
    expect(() => new SeatManager({ seatLimit: -1, seats: [] })).toThrow(RangeError);
  });
});
