export type ConsultingSlotStatus = "draft" | "available" | "reserved" | "completed" | "cancelled";

export interface ConsultingSlot {
  id: string;
  sellerId: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  price: string;
  currency: "USDC";
  capacity: number;
  reservedSeats: number;
  status: ConsultingSlotStatus;
  depositRequired?: string;
}

export interface ConsultingReservationInput {
  buyerId: string;
  seatCount?: number;
  paidAmount: string;
}

export interface ConsultingReservation {
  slotId: string;
  buyerId: string;
  seatCount: number;
  status: "confirmed" | "requires_payment" | "unavailable";
  amountDue: string;
}

export function remainingConsultingSeats(slot: ConsultingSlot): number {
  return Math.max(0, slot.capacity - slot.reservedSeats);
}

export function canReserveConsultingSlot(slot: ConsultingSlot, seatCount = 1): boolean {
  return slot.status === "available" && seatCount > 0 && remainingConsultingSeats(slot) >= seatCount;
}

export function reserveConsultingSlot(
  slot: ConsultingSlot,
  input: ConsultingReservationInput,
): ConsultingReservation {
  const seatCount = input.seatCount ?? 1;

  if (!canReserveConsultingSlot(slot, seatCount)) {
    return {
      slotId: slot.id,
      buyerId: input.buyerId,
      seatCount,
      status: "unavailable",
      amountDue: slot.depositRequired ?? slot.price,
    };
  }

  const amountDue = slot.depositRequired ?? slot.price;

  return {
    slotId: slot.id,
    buyerId: input.buyerId,
    seatCount,
    status: Number(input.paidAmount) >= Number(amountDue) ? "confirmed" : "requires_payment",
    amountDue,
  };
}
