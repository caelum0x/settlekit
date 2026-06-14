import { generateId, type Bundle, type Money, type PriceInterval } from "@settlekit/common";

export function createBundle(input: {
  merchantId: string;
  organizationId: string;
  name: string;
  description: string;
  productIds: string[];
  price: Money;
  interval: PriceInterval;
}, now = new Date()): Bundle {
  return {
    ...input,
    id: generateId("bundle"),
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
