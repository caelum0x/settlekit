import type { Currency, Money } from "../money.js";

/** Everything a developer can sell on SettleKit (plan §2). */
export type ProductType =
  | "saas_plan"
  | "github_repo_access"
  | "github_org_team_access"
  | "api_access"
  | "paid_api_call"
  | "ai_agent_service"
  | "digital_download"
  | "code_template"
  | "dataset"
  | "license_key"
  | "private_package"
  | "discord_access"
  | "support_plan"
  | "course_or_content"
  | "consulting_slot"
  | "escrow_task"
  | "bundle";

export type ProductStatus = "draft" | "active" | "archived";

export type DeliveryMode =
  | "github_invite"
  | "github_team_add"
  | "license_key"
  | "api_key"
  | "file_download"
  | "discord_role"
  | "saas_entitlement"
  | "webhook"
  | "email"
  | "bundle"
  | "none";

export interface Product {
  id: string;
  merchantId: string;
  organizationId: string;
  name: string;
  description: string;
  type: ProductType;
  status: ProductStatus;
  deliveryMode: DeliveryMode;
  /** Free-form, type-specific configuration (repo id, discord role id, etc.). */
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PriceInterval = "one_time" | "monthly" | "yearly";

export interface Price {
  id: string;
  productId: string;
  amount: string;
  currency: Currency;
  interval: PriceInterval;
  /** Usage-based prices charge per metered unit instead of a flat amount. */
  usageBased: boolean;
  /** For usage prices: amount per metered unit (e.g. per API call). */
  unitAmount?: string;
  /** For credit packs: number of credits granted when this price is purchased. */
  creditsGranted?: number;
  active: boolean;
  createdAt: string;
}

export interface Bundle {
  id: string;
  merchantId: string;
  organizationId: string;
  name: string;
  description: string;
  /** Product ids included in the bundle. */
  productIds: string[];
  price: Money;
  interval: PriceInterval;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FileAsset {
  id: string;
  merchantId: string;
  productId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Object storage key (S3/R2). */
  storageKey: string;
  checksumSha256: string;
  createdAt: string;
}
