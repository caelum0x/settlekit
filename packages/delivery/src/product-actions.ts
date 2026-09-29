/**
 * Derive a product's delivery actions (shared by the API and the worker).
 *
 * `metadata.deliveryActions` (an explicit, validated action list) wins;
 * otherwise the action follows the product's `deliveryMode` + metadata, the
 * same mapping the checkout app uses. Bundles / `none` yield no actions.
 */
import type { DeliveryAction, Product } from "@settlekit/common";

type Meta = Record<string, unknown>;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function str(meta: Meta, key: string, fallback = ""): string {
  const value = meta[key];
  return nonEmpty(value) ? value : fallback;
}

function strArray(meta: Meta, key: string, fallback: string[]): string[] {
  const value = meta[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? (value as string[]) : fallback;
}

function isFeatureMap(value: unknown): value is Record<string, boolean | number | string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Meta).every((v) => typeof v === "boolean" || typeof v === "number" || typeof v === "string")
  );
}

function isUrl(value: unknown): value is string {
  if (!nonEmpty(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** Validate one explicit action; returns the normalized action or undefined. */
export function parseDeliveryAction(raw: unknown): DeliveryAction | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const a = raw as Meta;
  switch (a.type) {
    case "github_invite": {
      if (!nonEmpty(a.repoId)) return undefined;
      const permission = a.permission;
      if (permission !== undefined && permission !== "pull" && permission !== "push" && permission !== "maintain") return undefined;
      return { type: "github_invite", repoId: a.repoId, ...(permission ? { permission } : {}) };
    }
    case "github_team_add":
      return nonEmpty(a.orgLogin) && nonEmpty(a.teamSlug) ? { type: "github_team_add", orgLogin: a.orgLogin, teamSlug: a.teamSlug } : undefined;
    case "license_key_create":
      return nonEmpty(a.policyId) ? { type: "license_key_create", policyId: a.policyId } : undefined;
    case "api_key_create":
      return Array.isArray(a.scopes) && a.scopes.length > 0 && a.scopes.every(nonEmpty)
        ? { type: "api_key_create", scopes: [...(a.scopes as string[])] }
        : undefined;
    case "file_access_grant":
      return nonEmpty(a.fileId) ? { type: "file_access_grant", fileId: a.fileId } : undefined;
    case "discord_role_add":
      return nonEmpty(a.guildId) && nonEmpty(a.roleId) ? { type: "discord_role_add", guildId: a.guildId, roleId: a.roleId } : undefined;
    case "saas_entitlement_create":
      return isFeatureMap(a.features) ? { type: "saas_entitlement_create", features: { ...a.features } } : undefined;
    case "webhook_send":
      return isUrl(a.url) ? { type: "webhook_send", url: a.url } : undefined;
    case "email_send":
      return nonEmpty(a.template) ? { type: "email_send", template: a.template } : undefined;
    default:
      return undefined;
  }
}

function fromMode(product: Product): DeliveryAction | undefined {
  const meta: Meta = product.metadata ?? {};
  switch (product.deliveryMode) {
    case "github_invite":
      return { type: "github_invite", repoId: str(meta, "repoId", product.id) };
    case "github_team_add":
      return { type: "github_team_add", orgLogin: str(meta, "orgLogin"), teamSlug: str(meta, "teamSlug") };
    case "license_key":
      return { type: "license_key_create", policyId: str(meta, "policyId", `pol_${product.id}`) };
    case "api_key":
      return { type: "api_key_create", scopes: strArray(meta, "scopes", ["read"]) };
    case "file_download":
      return { type: "file_access_grant", fileId: str(meta, "fileId", product.id) };
    case "discord_role":
      return { type: "discord_role_add", guildId: str(meta, "guildId"), roleId: str(meta, "roleId") };
    case "saas_entitlement":
      return { type: "saas_entitlement_create", features: isFeatureMap(meta.features) ? meta.features : {} };
    case "webhook":
      return { type: "webhook_send", url: str(meta, "url") };
    case "email":
      return { type: "email_send", template: str(meta, "template", "access_granted") };
    default:
      return undefined;
  }
}

/** The ordered delivery actions for `product` (empty for bundle/none). */
export function deliveryActionsFor(product: Product): DeliveryAction[] {
  const explicit = product.metadata?.deliveryActions;
  if (Array.isArray(explicit)) {
    const parsed = explicit.map(parseDeliveryAction);
    if (parsed.every((action): action is DeliveryAction => action !== undefined)) return parsed;
  }
  const action = fromMode(product);
  return action ? [action] : [];
}
