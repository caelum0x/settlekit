/**
 * Derive the {@link DeliveryAction} that fulfils a product from its persisted
 * `deliveryMode` + `metadata` (the "free-form, type-specific configuration"
 * field on every Product — repo id, discord role id, scopes, etc.). This is how
 * the checkout app renders the delivered-access summary from REAL product data
 * (no seed) when reading the catalog out of Postgres.
 */
import type { DeliveryAction, Product } from "@settlekit/common";

/** Read a string field from a product's metadata bag, or a fallback. */
function str(meta: Record<string, unknown>, key: string, fallback = ""): string {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Read a string-array field from metadata, or a fallback. */
function strArray(meta: Record<string, unknown>, key: string, fallback: string[]): string[] {
  const v = meta[key];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
  return fallback;
}

/**
 * Map a product to its delivery action. Returns `undefined` for delivery modes
 * with no buyer-facing artifact (`bundle`, `none`).
 */
export function deriveDeliveryAction(product: Product): DeliveryAction | undefined {
  const meta = product.metadata ?? {};
  switch (product.deliveryMode) {
    case "github_invite":
      return { type: "github_invite", repoId: str(meta, "repoId", product.id) };
    case "github_team_add":
      return {
        type: "github_team_add",
        orgLogin: str(meta, "orgLogin"),
        teamSlug: str(meta, "teamSlug"),
      };
    case "license_key":
      return { type: "license_key_create", policyId: str(meta, "policyId", `pol_${product.id}`) };
    case "api_key":
      return { type: "api_key_create", scopes: strArray(meta, "scopes", ["read"]) };
    case "file_download":
      return { type: "file_access_grant", fileId: str(meta, "fileId", product.id) };
    case "discord_role":
      return {
        type: "discord_role_add",
        guildId: str(meta, "guildId"),
        roleId: str(meta, "roleId"),
      };
    case "saas_entitlement": {
      const features = meta.features;
      return {
        type: "saas_entitlement_create",
        features:
          features && typeof features === "object"
            ? (features as Record<string, boolean | number | string>)
            : {},
      };
    }
    case "webhook":
      return { type: "webhook_send", url: str(meta, "url") };
    case "email":
      return { type: "email_send", template: str(meta, "template", "access_granted") };
    case "bundle":
    case "none":
    default:
      return undefined;
  }
}
