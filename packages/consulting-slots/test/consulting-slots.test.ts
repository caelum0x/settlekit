import { describe, expect, it } from "vitest";
import {
  canReserveConsultingSlot,
  remainingConsultingSeats,
  reserveConsultingSlot,
  type ConsultingSlot,
} from "../src/index.js";

describe("consulting slots", () => {
  const slot: ConsultingSlot = {
    id: "slot_1",
    sellerId: "seller_1",
    title: "Architecture review",
    startsAt: "2026-07-01T15:00:00.000Z",
    durationMinutes: 60,
    price: "150",
    currency: "USDC",
    capacity: 2,
    reservedSeats: 1,
    status: "available",
    depositRequired: "50",
  };

  it("tracks remaining capacity", () => {
    expect(remainingConsultingSeats(slot)).toBe(1);
    expect(canReserveConsultingSlot(slot)).toBe(true);
    expect(canReserveConsultingSlot(slot, 2)).toBe(false);
  });

  it("confirms reservations when the deposit is paid", () => {
    expect(reserveConsultingSlot(slot, { buyerId: "buyer_1", paidAmount: "50" })).toEqual({
      slotId: "slot_1",
      buyerId: "buyer_1",
      seatCount: 1,
      status: "confirmed",
      amountDue: "50",
    });
  });

  it("marks underpaid reservations as requiring payment", () => {
    expect(reserveConsultingSlot(slot, { buyerId: "buyer_1", paidAmount: "25" }).status).toBe(
      "requires_payment",
    );
  });
});
