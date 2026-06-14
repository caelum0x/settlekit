export interface SaasPlan {
  id: string;
  productId: string;
  name: string;
  features: Record<string, boolean | number | string>;
  seatsIncluded: number;
  usageLimits: Record<string, number>;
}

export interface SeatAssignment {
  userId: string;
  assignedAt: string;
}

export interface TenantEntitlements {
  customerId: string;
  planId: string;
  features: Record<string, boolean | number | string>;
  seatsIncluded: number;
  seatsAssigned: SeatAssignment[];
  usageLimits: Record<string, number>;
}
