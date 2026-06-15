export interface SeatPool {
  organizationId: string;
  limit: number;
  assignedUserIds: string[];
}

export function assignSeat(pool: SeatPool, userId: string): SeatPool {
  if (pool.assignedUserIds.includes(userId)) return pool;
  if (pool.assignedUserIds.length >= pool.limit) throw new Error("seat limit reached");
  return { ...pool, assignedUserIds: [...pool.assignedUserIds, userId] };
}

export function removeSeat(pool: SeatPool, userId: string): SeatPool {
  return { ...pool, assignedUserIds: pool.assignedUserIds.filter((id) => id !== userId) };
}

export function seatsRemaining(pool: SeatPool): number {
  return Math.max(0, pool.limit - pool.assignedUserIds.length);
}
