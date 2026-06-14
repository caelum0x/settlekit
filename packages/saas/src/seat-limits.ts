import type { TenantEntitlements } from "./types.js";

export function seatsAvailable(entitlements: TenantEntitlements): number {
  return Math.max(0, entitlements.seatsIncluded - entitlements.seatsAssigned.length);
}

export function canAssignSeat(entitlements: TenantEntitlements): boolean {
  return seatsAvailable(entitlements) > 0;
}

export function assignSeat(entitlements: TenantEntitlements, userId: string, now = new Date()): TenantEntitlements {
  if (entitlements.seatsAssigned.some((seat) => seat.userId === userId)) return entitlements;
  if (!canAssignSeat(entitlements)) throw new RangeError("seat limit exceeded");
  return { ...entitlements, seatsAssigned: [...entitlements.seatsAssigned, { userId, assignedAt: now.toISOString() }] };
}
