/** Product types offered in onboarding (client-safe: no node imports). */
export const PRODUCT_KINDS = ["saas_plan", "api_access", "consulting_slot", "support_plan", "digital_download"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
