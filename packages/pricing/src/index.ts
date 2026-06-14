export type HostedPlan = "free" | "creator" | "pro" | "business" | "enterprise";

export interface HostedPlanLimits {
  products: number | "unlimited";
  transactionFeeBps: number;
  marketplaceFeeBps: number;
}

export const HOSTED_PLAN_LIMITS: Record<HostedPlan, HostedPlanLimits> = {
  free: { products: 3, transactionFeeBps: 100, marketplaceFeeBps: 1500 },
  creator: { products: 20, transactionFeeBps: 75, marketplaceFeeBps: 1000 },
  pro: { products: 100, transactionFeeBps: 50, marketplaceFeeBps: 750 },
  business: { products: "unlimited", transactionFeeBps: 25, marketplaceFeeBps: 500 },
  enterprise: { products: "unlimited", transactionFeeBps: 0, marketplaceFeeBps: 0 },
};

export function canCreateProduct(plan: HostedPlan, currentProducts: number): boolean {
  const limit = HOSTED_PLAN_LIMITS[plan].products;
  return limit === "unlimited" || currentProducts < limit;
}

export function feeAmount(amountBaseUnits: bigint, feeBps: number): bigint {
  return (amountBaseUnits * BigInt(feeBps)) / 10_000n;
}
