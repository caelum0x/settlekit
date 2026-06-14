import { generateId, type DeliveryMode, type Price, type Product, type ProductType } from "@settlekit/common";

export interface ProductTemplate {
  type: ProductType;
  deliveryMode: DeliveryMode;
  requiredBuyerFields: string[];
}

export const PRODUCT_TEMPLATES: Record<string, ProductTemplate> = {
  githubRepo: { type: "github_repo_access", deliveryMode: "github_invite", requiredBuyerFields: ["githubUsername"] },
  saasPlan: { type: "saas_plan", deliveryMode: "saas_entitlement", requiredBuyerFields: ["email"] },
  paidApi: { type: "paid_api_call", deliveryMode: "api_key", requiredBuyerFields: ["email"] },
  digitalDownload: { type: "digital_download", deliveryMode: "file_download", requiredBuyerFields: ["email"] },
  discordAccess: { type: "discord_access", deliveryMode: "discord_role", requiredBuyerFields: ["discordUserId"] },
};

export function createProductDraft(input: {
  merchantId: string;
  organizationId: string;
  name: string;
  description: string;
  template: ProductTemplate;
  metadata?: Record<string, unknown>;
}, now = new Date()): Product {
  return {
    id: generateId("product"),
    merchantId: input.merchantId,
    organizationId: input.organizationId,
    name: input.name,
    description: input.description,
    type: input.template.type,
    status: "draft",
    deliveryMode: input.template.deliveryMode,
    metadata: { requiredBuyerFields: input.template.requiredBuyerFields, ...(input.metadata ?? {}) },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function publishProduct(product: Product, prices: Price[], now = new Date()): Product {
  if (!prices.some((price) => price.productId === product.id && price.active)) {
    throw new Error("product requires at least one active price before publishing");
  }
  return { ...product, status: "active", updatedAt: now.toISOString() };
}
